export function createDb() {
  var MongoClient = require("mongodb").MongoClient;
  var url = "mongodb://localhost:27017/";
  MongoClient.connect(url, function (err, db) {
    if (err) throw err;
    var dbo = db.db("mydb");
    dbo.createCollection("dailyInfo", function (err, result) {
      if (err) throw err;
      console.log("Created");
      db.close();
    });
  });
}

export function insertDb(mydb, objectToInsert, dataSource) {
  mydb.collection(dataSource).insertOne(objectToInsert);
}

export function updateDb(mydb, ownerAddress, newObject, dataSource) {
  var query = { accountAddress: ownerAddress };
  mydb.collection(dataSource).replaceOne(query, newObject);
}

export async function checkDbForOwner(ownerAddress, mydb) {
  let queryResult = null;
  var query = { accountAddress: ownerAddress };
  queryResult = await mydb.collection("dailyInfo").find(query).toArray();
  if (queryResult.length === 0) return false;

  return queryResult;
}

//api db functions

export async function checkDbForWallet(ownerAddress, mydb) {
  let queryResult = null;
  var query = { accountAddress: ownerAddress };
  queryResult = await mydb.collection("dailyInfo").find(query).toArray();
  if (queryResult.length === 0) return false;
  return queryResult;
}

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export async function formatDataAPI1(response) {
  if (!response) return null;
  let ownerAddress = response[0].accountAddress,
    dailyInfos = response[0].dailyInfos,
    latestDailyInfo = dailyInfos[dailyInfos.length - 1];
  let profitLoss = dailyProfits(dailyInfos),
    tokenData = formatTokenData(dailyInfos);
  return {
      tokenDistribution: latestDailyInfo,
      profitLossValue: profitLoss,
      dailyInfos: dailyInfos,
      tokenData: tokenData
  }
  /*
  for (var i=0; i<balances.length; i++)
  {
    let marketAddress = "";
    if (balances[i].effectiveMint === USDC_MINT){
      ress.push(
        {
          "tokenName": "USDC",
          "effectiveMint": USDC_MINT,
          "price": 1,
          "amount": balances[i].amount,
          "ownerTokenAddress": balances[i].ownerTokenAddress,
          "value": balances[i].amount
        }
      );
      break;
    }
    for (var j=0; j<tokens.tokens.length; j++){
      if (balances[i].effectiveMint === tokens.tokens[j].tokenMint)
      {
        marketAddress = tokens.tokens[j].marketAddress;
        break;
      }
    }
    let tokenPrice = await getPrice(new Connection("https://solana-api.projectserum.com"), marketAddress);
    ress.push( {
      "tokenName": balances[i].tokenName,
      "effectiveMint": balances[i].effectiveMint,
      "price": tokenPrice,
      "amount": balances[i].amount,
      "ownerTokenAddress": balances[i].ownerTokenAddress,
      "value": balances[i].amount * tokenPrice
    });
  }
  */
  return profitLoss;
}

export function dailyProfits(dailyInfos) {
    let profit_infos = [];
  for (var i = 0; i < dailyInfos.length; i++) {
    let eachDay = dailyInfos[i],
        value = getBalanceTotalValue(eachDay.balances); 
    if (i === 0){
        profit_infos.push({
            __time: eachDay.__time,
            profit: 0,
            value: value
        });
        if (dailyInfos.length === 1)
            break;
        else
            continue;
    }
    let todayProfit = value - profit_infos[i-1].value;
    profit_infos.push({
        __time: eachDay.__time,
        profit: parseFloat(todayProfit.toFixed(2)),
        value: value
    });
  }
  return profit_infos;
}

function getBalanceTotalValue(balances){
    let totalValue = 0;
    for (var i=0; i<balances.length; i++){
        totalValue = totalValue + (balances[i].amount*balances[i].price);
    }
    return totalValue;
}

export function formatTokenData(dailyInfo){
    let latestDailyInfo = dailyInfo[dailyInfo.length-1],
        effectiveMintsCurrently = [];
        for (var i=0; i<latestDailyInfo.balances.length; i++)
            effectiveMintsCurrently.push(latestDailyInfo.balances[i].effectiveMint);
        let mintDict = {};
        for (var j=0; j<dailyInfo.length; j++)
        {
            let dailyBalances = dailyInfo[j].balances;
            for (var k=0; k<dailyBalances.length; k++)
            {
                if (effectiveMintsCurrently.includes(dailyBalances[k].effectiveMint))
                {
                    let profit,
                        currentValue = parseFloat((dailyBalances[k].amount * dailyBalances[k].price).toFixed(2));
                    if (!mintDict[dailyBalances[k].effectiveMint])
                    {
                        mintDict[dailyBalances[k].effectiveMint] = [];
                        profit = 0;
                    }
                    else
                    {
                        let numberOfObjectsForThisToken = mintDict[dailyBalances[k].effectiveMint].length,
                            lastValueInDb = mintDict[dailyBalances[k].effectiveMint][numberOfObjectsForThisToken-1].value;
                        profit = parseFloat((currentValue - lastValueInDb).toFixed(2));
                    }
                    let tempOb = dailyBalances[k];
                    tempOb.__time = dailyInfo[j].__time
                    tempOb.profit = profit
                    tempOb.value = currentValue
                    mintDict[dailyBalances[k].effectiveMint].push(tempOb);
                }
            }

        }
        return mintDict;

}