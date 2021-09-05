import {checkDbForWallet, formatDataAPI1, insertDb, updateDb, checkDbForOwner} from "./dbOperations";
import {getPrice, getOwnerInfo} from "./tokens";
import * as tokenData from "./tokenInfoBackup.json";
import axios from "axios";
import moment from "moment";
import {PublicKey, Connection } from "@solana/web3.js";
var MongoClient = require('mongodb').MongoClient;
var url = "mongodb://localhost:27017/";
var connection = new Connection("https://solana-api.projectserum.com");
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function getTokenNameFromMint(mintAddress){
  for (var i=0; i<tokenData.tokens.length; i++){
    if(tokenData.tokens[i].tokenMint === mintAddress)
      return tokenData.tokens[i].tokenName;
  }
  return "";
}
function formatDecimal(balanceWithoutDecimal, decimal){
  if (balanceWithoutDecimal === "0")
    return "0.0";
  if (decimal === 0)
    return balanceWithoutDecimal + ".0";
  if (decimal < balanceWithoutDecimal.length)
    return balanceWithoutDecimal.slice(0,balanceWithoutDecimal.length - decimal) + "." + balanceWithoutDecimal.slice(balanceWithoutDecimal.length - decimal);
  if (decimal === balanceWithoutDecimal.length)
    return "0." + balanceWithoutDecimal;
  if (decimal > balanceWithoutDecimal.length)
  {
    let numberOfZeroAfterDecimal = decimal - balanceWithoutDecimal.length;
    let zeroString = "0.";
    for (var i=0; i<numberOfZeroAfterDecimal; i++)
      zeroString = zeroString + "0"
    return zeroString+balanceWithoutDecimal;
  }
}

function getTransactionRequestBody(signature, index){
  let obj = {
    "method": "getConfirmedTransaction",
    "jsonrpc": "2.0",
    "params": [
      signature,
      {
        "encoding": "jsonParsed",
        "commitment": "confirmed"
      }
    ],
    "id": index
  }
  return obj;
}
async function callSignatureApi(stringToQuery){
  let body = stringToQuery;
  let response = await axios.post("https://api.mainnet-beta.solana.com/", JSON.stringify(body),{headers: {
    'Content-Type': 'application/json;charset=UTF-8',
    "Access-Control-Allow-Origin": "*",
  }});
  return response.data;
}

function isAddressFromUser(tokenAddress, tokenAccountResponse){
  let flag = false,
    response = {};
  for (var i=0; i<tokenAccountResponse.length; i++){
    if (tokenAccountResponse[i].pubkey === tokenAddress){
      flag = true;
      response = {
        mintAddress: tokenAccountResponse[i].account.data.parsed.info.mint,
        decimal: tokenAccountResponse[i].account.data.parsed.info.tokenAmount.decimals
      }
      break;
    }
  }
  if (!flag)
    return flag;
  return response;
}

function addDataToMintTransactions(mintTransactionMapping, parsedInstruction){
  let mint = parsedInstruction["mintAddress"],
    mintExists = mintTransactionMapping[mint];
    if (mintExists)
      mintExists.push(parsedInstruction);
    else
      mintExists = [parsedInstruction];
    mintTransactionMapping[mint] = mintExists;
    return mintTransactionMapping;
}

function parseInstructions(signature, instructions, tokenAccountResponse, time, mintTransactionMapping){
  let instructionResponse = [];
  for (var i=0; i<instructions.length; i++){
    let instruction = instructions[i];
    if (!instruction.parsed)
      continue;
    let dataToBeParsed = instruction.parsed.info,
      source = dataToBeParsed.source,
      destination = dataToBeParsed.destination,
      ifSourceIsOwner = isAddressFromUser(source, tokenAccountResponse),
      ifDestinationIsOwner = isAddressFromUser(destination, tokenAccountResponse),
      amount = dataToBeParsed.amount;
      if (ifSourceIsOwner && amount)
        amount = - parseFloat(formatDecimal(amount, ifSourceIsOwner["decimal"]));
      else if (ifDestinationIsOwner && amount)
        amount = parseFloat(formatDecimal(amount, ifDestinationIsOwner["decimal"]));
      else
        continue;
      if (amount===0)
        continue;
      let mint = ifDestinationIsOwner["mintAddress"] || ifSourceIsOwner["mintAddress"],
        parsedInstruction = {
          type: amount < 0 ? "Send" : "Receive",
          source: source,
          destination: destination,
          mintAddress: mint,
          amount: amount,
          tokenName: getTokenNameFromMint(mint),
          time: time,
          signature: signature
        };
      instructionResponse.push(parsedInstruction);
      mintTransactionMapping = addDataToMintTransactions(mintTransactionMapping, parsedInstruction);
  }
  return [instructionResponse, mintTransactionMapping];
}
function processSolTransfer(signature, result, ownerAddress, time, mintTransactionMapping){
  let decimals = 9,
    parsedInstruction = [],
    amount = result.transaction.message.instructions[0].parsed.info.lamports.toString(),
    source = result.transaction.message.instructions[0].parsed.info.source,
    destination = result.transaction.message.instructions[0].parsed.info.destination;
    if (source === ownerAddress)
      amount = - parseFloat(formatDecimal(amount, decimals));
    else if (destination === ownerAddress)
      amount = parseFloat(formatDecimal(amount, decimals));
    else
      return parsedInstruction;
    let parsedInstructionSingle = {
      type: amount < 0 ? "Send" : "Receive",
      source: source,
      destination: destination,
      mintAddress: "11111111111111111111111111111111",
      amount: amount,
      tokenName: "SOL",
      time: time,
      signature: signature
    };
    parsedInstruction.push(parsedInstructionSingle);
    mintTransactionMapping = addDataToMintTransactions(mintTransactionMapping, parsedInstructionSingle);
    return [parsedInstruction, mintTransactionMapping];
};

function filterRequiredTransactions(allResponses, tokenAccountResponse, ownerAddress){
  let mintTransactionMapping = {};
  let signatureTransactionMapping = {};
  for (var i=0; i<allResponses.length;i++){
    let transaction = allResponses[i];
    let parsedInstructions = [];
    let instructionsExists = transaction && transaction.result && transaction.result.meta && transaction.result.meta.innerInstructions 
    && transaction.result.meta.innerInstructions[0];
    let signature = transaction.result.transaction.signatures[0];
    if (instructionsExists){
      [parsedInstructions, mintTransactionMapping] = parseInstructions(signature, instructionsExists.instructions, tokenAccountResponse, transaction.result.blockTime, mintTransactionMapping);
    }
    else if(transaction && transaction.result && transaction.result.meta && transaction.result.meta.logMessages){
      try {
      if (transaction.result.meta.logMessages.includes("Program 11111111111111111111111111111111 success"))
      [parsedInstructions, mintTransactionMapping] = processSolTransfer(signature, transaction.result, ownerAddress, transaction.result.blockTime, mintTransactionMapping);
      }
      catch(e){
        console.log("Error Handling")
      }
    }
    if (parsedInstructions.length > 0)
      signatureTransactionMapping[signature] = parsedInstructions;
  }
  return [signatureTransactionMapping, mintTransactionMapping] ;
};

async function getTransactions(ownerAddress){
  let signatures = [];
  let allTransactionResponses = [];
  let bodyTransactions = {"method":"getConfirmedSignaturesForAddress2","jsonrpc":"2.0","params":[ownerAddress,{"commitment":"confirmed","limit":100}],"id":"ae9d28bc-35f0-4d94-830f-bd5d9cd58d6b"};
  let response = await axios.post("https://api.mainnet-beta.solana.com/", JSON.stringify(bodyTransactions),{headers: {
    'Content-Type': 'application/json;charset=UTF-8',
    "Access-Control-Allow-Origin": "*",
  }});
  for (var i=0; i<response.data.result.length; i++){
    if (!response.data.result[i].err)
      signatures.push(response.data.result[i].signature);
  }
  let stringToQuery = [];
  //let numberOfSignaturesToParse = signatures.length;
  let numberOfSignaturesToParse = signatures.length > 50 ? 50 : signatures.length;
  for (var i=0; i<numberOfSignaturesToParse; i++){
    stringToQuery.push(getTransactionRequestBody(signatures[i], i));
    if ((i+1)%14 === 0 || i === numberOfSignaturesToParse-1){
      let concatArray = await callSignatureApi(stringToQuery);
      allTransactionResponses = allTransactionResponses.concat(concatArray);
      stringToQuery=[];
    }
  }
  let tokenAccountInfo = {"jsonrpc":"2.0","id":1,"method":"getTokenAccountsByOwner","params":[ownerAddress,{"programId":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"},{"encoding":"jsonParsed"}]}
  let response2 = await axios.post("https://api.mainnet-beta.solana.com/", JSON.stringify(tokenAccountInfo),{headers: {
    'Content-Type': 'application/json;charset=UTF-8',
    "Access-Control-Allow-Origin": "*",
  }});
  let signatureTransactionMapping, mintTransactionMapping;
  [signatureTransactionMapping, mintTransactionMapping] = filterRequiredTransactions(allTransactionResponses, response2.data.result.value, ownerAddress);
  return [signatureTransactionMapping, mintTransactionMapping];
}

var cors = require('cors')
var express = require('express');
var app = express();
app.use(cors())

app.get('/welcome', function (req, res){
  res.send("Server is working!");
});

app.get('/getUserData/:walletAddress', async function (req, res) {
  let walletAddress = req.params.walletAddress;
  let db = await MongoClient.connect(url)
  var dbo = db.db("mydb");
  let ifUserExists = await checkDbForWallet(walletAddress, dbo);
  let responseToSend;
  if(!ifUserExists){
    res.send({ownerAddress:walletAddress, data:"First time user"});
    try{
    let walletAddressPublicKey = new PublicKey(walletAddress);
    collectAndSaveData(walletAddressPublicKey);
    }
    catch(e){
      console.log("caught invalid address");
    }
  }
  else{
    responseToSend = await formatDataAPI1(ifUserExists);
    res.send({ownerAddress:walletAddress, data:responseToSend});
  }
})

app.get('/getTransactions/:walletAddress', async function (req, res) {
  let walletAddress = req.params.walletAddress;
  let allTrasactions, mintTransactionMapping;
  [allTrasactions, mintTransactionMapping] = await getTransactions(walletAddress)
  res.send({ownerAddress:walletAddress, transactions:allTrasactions, mintMapping: mintTransactionMapping});
});

var server = app.listen(8081, function () {
  var host = server.address().address
  var port = server.address().port
  
  console.log("Example app listening at http://%s:%s", host, port)
})

//script code for saving first time user
const collectAndSaveData = async (solAddress) => {
  var response = await getOwnerInfo(connection, solAddress);
  if (response.length === 0)
  {
    console.log("Only Sol with user. Do more when we figure out to calculate sol balance");
    return;
  }
  let db = await MongoClient.connect(url)
  var dbo = db.db("mydb");
  let ifUserExists = await checkDbForOwner(solAddress.toBase58(), dbo);
  let formattedData;
  if (!ifUserExists){
    formattedData = await formatFirstTimeData(solAddress, response);
    insertDb(dbo, formattedData, "dailyInfo");
  }
  else{
    formattedData =await formatRecurringData(ifUserExists[0], response);
    updateDb(dbo, ifUserExists[0].accountAddress, formattedData, "dailyInfo");
  }
  console.log("finished collection");
};

async function formatFirstTimeData(ownerAddress, response){
let balances =[];
for (var i=0; i<response.length; i++){
  let ownerTokenAddress = response[i].ownerTokenAddress, 
      balance = response[i].balance , 
      effectiveMint = response[i].effectiveMint , 
      tokenName = response[i].tokenName , 
      supply = response[i].supply;

  let marketAddress = "";
  for (var j=0; j<tokenData.tokens.length; j++){
    if (effectiveMint === tokenData.tokens[j].tokenMint)
    {
      marketAddress = tokenData.tokens[j].marketAddress;
      break;
    }
  }
  let price = await getPrice(new Connection("https://solana-api.projectserum.com"),marketAddress);
  if (effectiveMint === USDC_MINT)
    price =1;
  if (marketAddress !== "")
    balances.push({
        "ownerTokenAddress": ownerTokenAddress,
        "effectiveMint": effectiveMint,
        "amount": parseFloat(balance),
        "tokenName": tokenName,
        "supply": supply,
        "marketAddress": marketAddress,
        "price": price
    })
};
let objectToInsert = {
  accountAddress: ownerAddress.toBase58(),
  dailyInfos: [
    {
      __time: moment().format("DD/MM/YYYY HH:mm:ss a"),
      balances: balances
    }
  ]
}
return objectToInsert;
}

async function formatRecurringData(dbData, apiResponse){
let existingDailyInfo = dbData.dailyInfos;
let balances = [];
for (var i=0; i<apiResponse.length; i++){
  let ownerTokenAddress = apiResponse[i].ownerTokenAddress, 
      balance = apiResponse[i].balance , 
      effectiveMint = apiResponse[i].effectiveMint , 
      tokenName = apiResponse[i].tokenName , 
      supply = apiResponse[i].supply;

  let marketAddress = "";
  for (var j=0; j<tokenData.tokens.length; j++){
    if (effectiveMint === tokenData.tokens[j].tokenMint)
    {
      marketAddress = tokenData.tokens[j].marketAddress;
      break;
    }
  }
  let price = await getPrice(new Connection("https://solana-api.projectserum.com"),marketAddress);
  if (effectiveMint === USDC_MINT)
    price =1;
  if (marketAddress !== "")
    balances.push({
      "ownerTokenAddress": ownerTokenAddress,
      "effectiveMint": effectiveMint,
      "amount": parseFloat(balance),
      "tokenName": tokenName,
      "supply": supply,
      "marketAddress": marketAddress,
      "price": price
    });
};
existingDailyInfo.push({
  __time: moment().format("DD/MM/YYYY HH:mm:ss a"),
  balances: balances
});

let objectToInsert = {
  accountAddress: dbData.accountAddress,
  dailyInfos: existingDailyInfo
}
return objectToInsert;
}
