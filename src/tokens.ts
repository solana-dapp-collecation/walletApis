import { Connection, PublicKey } from "@solana/web3.js";
import { Market } from '@project-serum/serum';
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
export const PROGRAM_ID = new PublicKey(
  "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
);

export async function getSolBalance(
  connection: Connection,
  ownerAddress: PublicKey,
){
  try{
    let response = await Promise.resolve(connection.getBalance(ownerAddress)),
      balanceWithoutDecimal = response.toString(),
      decimal = 9;
    let balance = balanceWithoutDecimal === "0" ? "0.0": decimal === 0 ? 
        balanceWithoutDecimal + ".0" 
        : 
        balanceWithoutDecimal.slice(0, decimal) + "." + balanceWithoutDecimal.slice(decimal);
    return balance;
  }
  catch(err){
    console.error("Unable to get Sol Balance")
    return false;
  }

}

//Not using currently

export function formatDecimal(balanceWithoutDecimal, decimal){
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


export async function getPrice(
  connection: Connection,
  marketAddress,
){
  if (marketAddress === "")
    return 0;
  marketAddress = new PublicKey(marketAddress);
  let market = await Market.load(connection, marketAddress, {}, PROGRAM_ID);
  let bids = await market.loadBids(connection);
  let amount = null;
  for (let [price, size] of bids.getL2(1)) {
    amount = price;
  }
  if (amount === null)
  {
    let asks = await market.loadAsks(connection);
    for (let [price, size] of asks.getL2(1)) {
      amount = price;
    }
  }
  return amount;
}