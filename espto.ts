import { RDSDataService } from 'aws-sdk';
import { ExecuteStatementRequest, BatchExecuteStatementRequest, BoxedDouble } from 'aws-sdk/clients/rdsdataservice';
import { randomUUID } from 'crypto';
const RDS = new RDSDataService()

// Undefined constants
export const INSERT_PAYMENT_SQL: string = 'INSERT_PAYMENT_SQL_str';
export const INSERT_FED_NOW_PAYMENT_SQL: string = 'INSERT_FED_NOW_PAYMENT_SQL_str';
export const INSERT_LEDGER_ENTRY_SQL: string = 'INSERT_LEDGER_ENTRY_SQL_str';
export const INSERT_PROMO_LEDGER_ENTRY_SQL: string = 'INSERT_PROMO_LEDGER_ENTRY_SQL_str';
export const INSERT_TRANSACTION_SQL: string = 'INSERT_TRANSACTION_SQL_str';

export interface IdObj {
  primaryPaymentID: string;
  customerLedgerEntryID: string;
  pursTransactionID: string;
  primaryFedNowPaymentID?: string;
  promotionLedgerEntryID?: string;
}

/**
 * @param {string} payer the id of the entity paying
 * @param {string} payee the id of the entity getting paid
 * @param {string} payerBankAccountID the bank account id of the entity paying
 * @param {string} payeeBankAccountID the bank account id of the entity getting paid
 * @param {string} dev the id of the developer
 * @param {BoxedDouble} amount the amount being paid
 * @param {BoxedDouble} interactionType 0 is mobile
 * @param {BoxedDouble} paymentMethod 0 is fedNow 1 is card
 */
export interface UserPurchaseInformation { 
  payer: string;
  payee: string;
  payerBankAccountID: string;
  payeeBankAccountID: string;
  dev: string;
  amount: BoxedDouble;
  interactionType: BoxedDouble;
  paymentMethod: BoxedDouble
}

/**
 * @param {BoxedDouble}  promoAmount if there is a promotion put an amount here
 */
export interface PromotionInformation {
  promoAmount: BoxedDouble
}

/**
 * Creates everything necessary to record a transaction bundle in RDS database
 *
 * A PTB (Purs Transaction Bundle) is a bundle of database records that are created as part of a Purs Transaction.
 * A single Transaction may include a promotion, it may include a Payment, it may include a fedNowPayment, but it always
 * includes at least one LedgerEntry
 * @param {Object} userPurchaseInformation
 * @param {string} userPurchaseInformation.payer the id of the entity paying
 * @param {string} userPurchaseInformation.payee the id of the entity getting paid
 * @param {string} userPurchaseInformation.payerBankAccountID the bank account id of the entity paying
 * @param {string} userPurchaseInformation.payeeBankAccountID the bank account id of the entity getting paid
 * @param {string} userPurchaseInformation.dev the id of the developer
 * @param {BoxedDouble} userPurchaseInformation.amount the amount being paid
 * @param {BoxedDouble} userPurchaseInformation.interactionType 0 is mobile
 * @param {BoxedDouble} userPurchaseInformation.paymentMethod 0 is fedNow 1 is card
 *
 * @param {Object}  promotionInformation
 * @param {BoxedDouble}  promotionInformation.promoAmount if there is a promotion put an amount here
 * @param {string} sqlTransactionID the id of the sql transaction
 * @returns {Promise<IdObj>} an object with the ledger entry id and the payment id
 */
export const executeStandardPTOperations = async (
  userPurchaseInformation: UserPurchaseInformation,
  promotionInformation: PromotionInformation,
  sqlTransactionID: string
) : Promise<IdObj> => {

  // Extract parameters
  const {
    amount,
    paymentMethod,
  } = userPurchaseInformation;

  const { 
    promoAmount 
  } = promotionInformation;

  // Initialize variables
  const ledgerEntries : string[] = [];
  const fedNowPaymentID: string = generateRandomBinary(32);
  
  const idObj: IdObj = {
    primaryPaymentID: generateRandomBinary(32),
    customerLedgerEntryID: generateRandomBinary(32),
    pursTransactionID: generateRandomBinary(32),
  };

  // Generate ExecuteStatementRequest
  const params: ExecuteStatementRequest = generateExecuteStatementRequest(
    userPurchaseInformation,
    sqlTransactionID,
    idObj,
    fedNowPaymentID
    );

  await insertPayment(params, idObj, ledgerEntries);

  // this is an additional step for processing fedNow payments
  if (paymentMethod === 0 && amount > 0) {
    await insertFedNow(params, idObj, ledgerEntries, fedNowPaymentID);
  }

  await insertLedgerEntry(params);

  if (promoAmount > 0) {
    await insertPromoLedger(params, idObj, ledgerEntries);
  }

  await insertTransaction(params, idObj, ledgerEntries);

  return idObj;
}




// New Functions

/**
 * Generates an ExecuteStatementRequest which can be used to execute all relevant SQL queries to RDS
 * @param {Object} userPurchaseInformation 
 * @param {string} userPurchaseInformation.payer The id of the entity paying
 * @param {string} userPurchaseInformation.payee The id of the entity getting paid
 * @param {string} userPurchaseInformation.payerBankAccountID The bank account id of the entity paying
 * @param {string} userPurchaseInformation.payeeBankAccountID The bank account id of the entity getting paid
 * @param {string} userPurchaseInformation.dev The id of the developer
 * @param {BoxedDouble} userPurchaseInformation.amount The amount being paid
 * @param {BoxedDouble} userPurchaseInformation.interactionType 0 is mobile
 * @param {BoxedDouble} userPurchaseInformation.paymentMethod 0 is fedNow 1 is card
 * @param {string} sqlTransactionID The id of the sql transaction 
 * @param {IdObj} idObj An object containing the guaranteed ledger ids
 * @param {string} fedNowPaymentID The fed now payment ledger id (the associated transaction is not guaranteed)
 * @returns {ExecuteStatementRequest} An ExecuteStatementRequest with all relevant parameters
 */
function generateExecuteStatementRequest(
  userPurchaseInformation: {
    payer: string;
    payee: string;
    payerBankAccountID: string;
    payeeBankAccountID: string;
    dev: string;
    amount: BoxedDouble;
    interactionType: BoxedDouble;
    paymentMethod: BoxedDouble;
  },
  sqlTransactionID: string,
  idObj: IdObj,
  fedNowPaymentID: string
) : ExecuteStatementRequest {
  
  // Extract parameters
  const {
    payer,
    payee,
    payerBankAccountID,
    payeeBankAccountID,
    dev,
    amount,
    interactionType,
    paymentMethod,
  } = userPurchaseInformation;
  
  // Generate and return the ExecuteStatementRequest
  return {
    database: process.env.DATABASE,
    secretArn: process.env.SECRET_ARN!,
    resourceArn: process.env.CLUSTER_ARN!,
    transactionId: sqlTransactionID,
    sql: '',
    parameters: [
      {
        name: 'payerId',
        value: {
          blobValue: Buffer.from(payer, 'hex'),
        },
      },
      {
        name: 'payeeId',
        value: {
          blobValue: Buffer.from(payee, 'hex'),
        },
      },
      {
        name: 'paymentAmount',
        value: {
          doubleValue: amount,
        },
      },
      {
        name: 'interactionTypeId',
        value: {
          doubleValue: interactionType,
        },
      },
      {
        name: 'paymentId',
        value: {
          blobValue: Buffer.from(idObj.primaryPaymentID, 'hex'),
        },
      },
      {
        name: 'datePaid',
        value: {
          stringValue: paymentMethod === 0 && amount > 0 ?
            undefined : new Date().toISOString().slice(0, 19).replace('T', ' '),
          isNull: paymentMethod === 0 && amount > 0,
        },
      },
      {
        name: 'ledgerId',
        value: {
          blobValue: Buffer.from(idObj.customerLedgerEntryID, 'hex'),
        },
      },
      {
        name: 'developerId',
        value: {
          blobValue: Buffer.from(dev, 'hex'),
        },
      },
      {
        name: 'paymentMethod',
        value: {
          doubleValue: paymentMethod,
        },
      },
      {
        name: 'paymentStatus',
        value: {
          // the status is set to 'completed' if the payment is a card or if the amount is 0; otherwise the status is 
          // set to pending(ie. fedNow)
          doubleValue: paymentMethod !== 0 || amount === 0 ? 4 : 5,
        },
      },
      {
        name: 'fedNowPaymentId',
        value: {
          blobValue: Buffer.from(fedNowPaymentID, 'hex'),
        },
      },
      {
        name: 'payerAccountId',
        value: {
          stringValue: payerBankAccountID
        },
      },
      {
        name: 'payeeAccountId',
        value: {
          stringValue: payeeBankAccountID
        },
      },
    ]
  }
}

/**
 * Performs the insert payment query
 * The relevant SQL query is found in INSERT_PAYMENT_SQL
 * @param {ExecuteStatementRequest} params An ExecuteStatementRequest with all relevant parameters
 * @param {IdObj} idObj An object containing the guaranteed ledger ids
 * @param {string[]} ledgerEntries An array of all ledger ids for all transactions performed
 */
async function insertPayment(params: ExecuteStatementRequest, idObj: IdObj, ledgerEntries: string[]) {
  ledgerEntries.push(idObj.customerLedgerEntryID);

  params.sql = INSERT_PAYMENT_SQL;
  await RDS.executeStatement({ ...params }).promise();
}

/**
 * Performs the insert fed now query
 * @param {ExecuteStatementRequest} params An ExecuteStatementRequest with all relevant parameters
 * @param {IdObj} idObj An object containing the guaranteed ledger ids
 * @param {string[]} ledgerEntries An array of all ledger ids for all transactions performed
 * @param {string} fedNowPaymentID The fed now payment ledger id
 */
async function insertFedNow(params: ExecuteStatementRequest, idObj: IdObj, ledgerEntries: string[], 
  fedNowPaymentID: string) {

  idObj.primaryFedNowPaymentID = fedNowPaymentID;
  // ledgerEntries.push(idObj.primaryFedNowPaymentID); TODO Is this supposed to be here?

  params.sql = INSERT_FED_NOW_PAYMENT_SQL;
  await RDS.executeStatement({ ...params }).promise();
}

/**
 * Performs the insert ledger query
 * The relevant SQL query is found in INSERT_LEDGER_SQL
 * @param {ExecuteStatementRequest} params An ExecuteStatementRequest with all relevant parameters
 */
async function insertLedgerEntry(params: ExecuteStatementRequest) {
  params.sql = INSERT_LEDGER_ENTRY_SQL;
  await RDS.executeStatement({ ...params }).promise();
}

/**
 * Performs the insert promo query
 * The relevant SQL query is found in INSERT_PROMO_SQL
 * @param {ExecuteStatementRequest} params An ExecuteStatementRequest with all relevant parameters
 * @param {IdObj} idObj An object containing the guaranteed ledger ids
 * @param {string[]} ledgerEntries An array of all ledger ids for all transactions performed
 */
async function insertPromoLedger(params: ExecuteStatementRequest, idObj: IdObj, ledgerEntries: string[]) {
  idObj.promotionLedgerEntryID = generateRandomBinary(32);
  ledgerEntries.push(idObj.promotionLedgerEntryID);

  params.sql = INSERT_PROMO_LEDGER_ENTRY_SQL;
  await RDS.executeStatement({ ...params }).promise();
}

/**
 * Performs the insert transaction query
 * The relevant SQL query is found in INSERT_TRANSACTION_SQL
 * @param {ExecuteStatementRequest} params An ExecuteStatementRequest with all relevant parameters
 * @param {IdObj} idObj An object containing the guaranteed ledger ids
 * @param {string[]} ledgerEntries An array of all ledger ids for all transactions performed
 */
async function insertTransaction(params: ExecuteStatementRequest, idObj: IdObj, ledgerEntries: string[]) {
  let batchParams: BatchExecuteStatementRequest = convertExecuteStatementRequestToBatch(params);

  batchParams.parameterSets = ledgerEntries.map((ledgerId) => [
    {
      name: 'transactionId',
      value: {
        blobValue: Buffer.from(idObj.pursTransactionID, 'hex'),
      },
    },
    {
      name: 'ledgerId',
      value: {
        blobValue: Buffer.from(ledgerId, 'hex'),
      },
    }
  ]);

  batchParams.sql = INSERT_TRANSACTION_SQL;
  await RDS.batchExecuteStatement({ ...batchParams }).promise();
}


function generateRandomBinary(arg0: number): string {
  return randomUUID();
}

/**
 * Accepts an ExecuteStatementRequest and returns an equivialent BatchExecuteStatementRequest
 * executeStatementRequest.parameters is discarded, and the parameterSets property is left undefined
 * @param {ExecuteStatementRequest} executeStatementRequest The ExecuteStatementRequest to be converted
 * @returns {BatchExecuteStatementRequest} A BatchExecuteStatementRequest based on executeStatementRequest
 */
function convertExecuteStatementRequestToBatch(executeStatementRequest: ExecuteStatementRequest): 
  BatchExecuteStatementRequest {

  return {
    resourceArn: executeStatementRequest.resourceArn,
    secretArn: executeStatementRequest.secretArn,
    sql: executeStatementRequest.sql,
    database: executeStatementRequest.database,
    schema: executeStatementRequest.schema,
    transactionId: executeStatementRequest.transactionId,
  }
}

