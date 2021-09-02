import {checkDbForWallet, formatDataAPI1} from "./dbOperations";
import * as tokenData from "./tokenInfoBackup.json";
import axios from "axios";

var MongoClient = require('mongodb').MongoClient;
var url = "mongodb://localhost:27017/";


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
      if (transaction.result.meta.logMessages.includes("Program 11111111111111111111111111111111 success"))
      [parsedInstructions, mintTransactionMapping] = processSolTransfer(signature, transaction.result, ownerAddress, transaction.result.blockTime, mintTransactionMapping);
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
app.get('/getUserData/:walletAddress', async function (req, res) {
  let walletAddress = req.params.walletAddress;
  let db = await MongoClient.connect(url)
  var dbo = db.db("mydb");
  let ifUserExists = await checkDbForWallet(walletAddress, dbo);
  let responseToSend;
  if(!ifUserExists)
    res.send({ownerAddress:walletAddress, data:"First time user"});
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