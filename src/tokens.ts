import { Connection, PublicKey } from "@solana/web3.js";
import * as BufferLayout from "buffer-layout";
import { Market } from '@project-serum/serum';
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
export const PROGRAM_ID = new PublicKey(
  "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
);
import * as tokens from "./tokenInfoBackup.json";
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

export const ACCOUNT_LAYOUT = BufferLayout.struct([
  BufferLayout.blob(32, "mint"),
  BufferLayout.blob(32, "owner"),
  BufferLayout.nu64("amount"),
  BufferLayout.blob(93),
]);


export function parseTokenAccountData(data: Buffer): {
  mint: PublicKey;
  owner: PublicKey;
  amount: number;
} {
  let { mint, owner, amount } = ACCOUNT_LAYOUT.decode(data);
  return {
    mint: new PublicKey(mint),
    owner: new PublicKey(owner),
    amount,
  };
}

export function getOwnedAccountsFilters(publicKey: PublicKey) {
  return [
    {
      memcmp: {
        offset: 32,
        bytes: publicKey.toBase58(),
      },
    },
    {
      dataSize: 165,
    },
  ];
}

export async function getOwnerInfo(
  connection: Connection,
  ownerAddress: PublicKey,
) {
  try{
  let response = await Promise.resolve(connection.getProgramAccounts(TOKEN_PROGRAM_ID,{commitment: "recent", filters: getOwnedAccountsFilters(ownerAddress)}))
  const parsedSplAccounts = response.map(
    ({ pubkey, account }) => {
      let decimal,
        name = "",
        supply, 
        effectiveMint = parseTokenAccountData(account.data).mint.toBase58(),
        balanceWithoutDecimal = parseTokenAccountData(account.data).amount.toString();
      for (var i=0; i<tokens.tokens.length; i++){
        if (effectiveMint === tokens.tokens[i].tokenMint)
        {
          decimal = tokens.tokens[i].decimals;
          name = tokens.tokens[i].tokenName || "";
          supply = tokens.tokens[i].supply || 0
          break;
        }
        decimal = 0;
        name = "";
        supply = 0;
      }
      let balance = formatDecimal(balanceWithoutDecimal, decimal);
      return {
        ownerTokenAddress: pubkey.toBase58(),
        balance: balance,
        effectiveMint: effectiveMint,
        tokenName: name,
        supply: supply
      };
    },
  );
  return parsedSplAccounts;
}
catch(err){
  console.error("Failed to fetch details for owner "+ownerAddress.toBase58());
  return null;
}}