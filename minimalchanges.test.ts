import {
    executeStandardPTOperations,
    PromotionInformation,
    UserPurchaseInformation,
    IdObj,
    INSERT_PAYMENT_SQL,
    INSERT_LEDGER_ENTRY_SQL,
    INSERT_FED_NOW_PAYMENT_SQL,
    INSERT_TRANSACTION_SQL,
    INSERT_PROMO_LEDGER_ENTRY_SQL 
} from './minimalchanges'
import {expect,
    jest, test} from '@jest/globals';
import { 
    ExecuteStatementRequest,
    SqlParameter,
    BoxedDouble,
    BatchExecuteStatementRequest
} from 'aws-sdk/clients/rdsdataservice';
const AWS = require('aws-sdk');

// Mock RDSDataService
jest.mock('aws-sdk', () => {

    // These need to be implemented using structuredClone because jest.fn.mock.calls only stores references.
    const executeStatementCalls: ExecuteStatementRequest[] = [];
    const batchExecuteStatementCalls: BatchExecuteStatementRequest[] = [];

    // Static functions
    // If these are included in the mocked RDSDataService, they cannot be tracked.
    const executeStatementFn = jest.fn((request: ExecuteStatementRequest) => { 
        executeStatementCalls.push(structuredClone(request));
        return {promise: () => Promise.resolve()};
    });
    const batchExecuteStatementFn = jest.fn((request: BatchExecuteStatementRequest) => { 
        batchExecuteStatementCalls.push(structuredClone(request));
        return {promise: () => Promise.resolve()};
    });

    return {
        RDSDataService: jest.fn(() => {
            return {
                constructor: () => {},
                executeStatement: executeStatementFn,
                batchExecuteStatement: batchExecuteStatementFn,
            }
        }),
        executeStatementCalls: executeStatementCalls,
        batchExecuteStatementCalls: batchExecuteStatementCalls,
    }
})

// TODO verify parameters

describe("test", () => {
    const RDS = new AWS.RDSDataService();

    // Initialize environment variables
    beforeAll(() => {
        process.env.SECRET_ARN = 'TEST_SECRET_ARN';
        process.env.CLUSTER_ARN = 'TEST_CLUSTER_ARN';
    });

    afterEach(() => {
        jest.clearAllMocks();

        // Empty the call arrays. Replacing the reference breaks tests.
        AWS.executeStatementCalls.length = 0;
        AWS.batchExecuteStatementCalls.length = 0;
    });

    test("All queries", async () => {

        // INPUT
        const userPurchaseInformation: UserPurchaseInformation = {
            payer: 'payer_str',
            payee: 'payee_str',
            payerBankAccountID: 'payerBankAccountId_str',
            payeeBankAccountID: 'payeeBankAccountID_str',
            dev: 'dev_str',
            amount: 1,              // Must be > 0 for FedNow
            interactionType: 123,
            paymentMethod: 0,       // Must be === 0 for FedNow
        }

        const promotionInformation: PromotionInformation = {
            promoAmount: 1,         // Must be > 0 for PromoLedger 
        }

        const sqlTransactionID = 'sqlTransactionID_str'

        // TEST
        const idObj: IdObj = await executeStandardPTOperations(
            userPurchaseInformation, 
            promotionInformation, 
            sqlTransactionID,
        );

        // RESULTS

        // Verify id.Obj contains the correct IDs
        expect(idObj.primaryPaymentID).toBeDefined();
        expect(idObj.customerLedgerEntryID).toBeDefined();
        expect(idObj.pursTransactionID).toBeDefined();
        expect(idObj.primaryFedNowPaymentID).toBeDefined();
        expect(idObj.promotionLedgerEntryID).toBeDefined();

        // Verify API calls have been called the correct number of times
        expect(RDS.executeStatement).toHaveBeenCalledTimes(4);
        expect(RDS.batchExecuteStatement).toHaveBeenCalledTimes(1);

        // Most test cases below are likely too detailed, but they do find a bug in the original espto.js.

        // Get each request passed into the mocked API calls
        let i: number = 0;
        const paymentRequest: ExecuteStatementRequest = AWS.executeStatementCalls[i++];
        const fedNowRequest: ExecuteStatementRequest = AWS.executeStatementCalls[i++];
        const ledgerEntryRequest: ExecuteStatementRequest = AWS.executeStatementCalls[i++];
        const promoLedgerEntryRequest: ExecuteStatementRequest = AWS.executeStatementCalls[i++];
        const transactionRequest: BatchExecuteStatementRequest = AWS.batchExecuteStatementCalls[0];

        // Verify that each request contains the correct standard parameters
        testSingleStatementRequest(paymentRequest, idObj, userPurchaseInformation, sqlTransactionID);
        testSingleStatementRequest(fedNowRequest, idObj, userPurchaseInformation, sqlTransactionID);
        testSingleStatementRequest(ledgerEntryRequest, idObj, userPurchaseInformation, sqlTransactionID);
        testSingleStatementRequest(promoLedgerEntryRequest, idObj, userPurchaseInformation, sqlTransactionID);

        // Make sure payment status is correct
        testParameterDouble(paymentRequest.parameters!, 'paymentStatus', 5);
        testParameterString(paymentRequest.parameters!, 'datePaid', undefined, true);

        // Verify that each request used the correct SQL query
        expect(paymentRequest.sql).toBe(INSERT_PAYMENT_SQL);
        expect(fedNowRequest.sql).toBe(INSERT_FED_NOW_PAYMENT_SQL);
        expect(ledgerEntryRequest.sql).toBe(INSERT_LEDGER_ENTRY_SQL);
        expect(promoLedgerEntryRequest.sql).toBe(INSERT_PROMO_LEDGER_ENTRY_SQL);
        expect(transactionRequest.sql).toBe(INSERT_TRANSACTION_SQL);

        // Verify the contents of the transaction request.
        expect(transactionRequest.parameterSets?.length).toBe(2);

        // insertPayment
        testParameterBlob(transactionRequest.parameterSets?.[0]!, 'transactionId', idObj.pursTransactionID);
        testParameterBlob(transactionRequest.parameterSets?.[0]!, 'ledgerId', idObj.customerLedgerEntryID);

        // insertPromoLedger
        testParameterBlob(transactionRequest.parameterSets?.[1]!, 'transactionId', idObj.pursTransactionID);
        testParameterBlob(transactionRequest.parameterSets?.[1]!, 'ledgerId', idObj.promotionLedgerEntryID!);
    })

    test("No FedNow", async () => {
        

        // INPUT
        const userPurchaseInformation: UserPurchaseInformation = {
            payer: 'payer_str',
            payee: 'payee_str',
            payerBankAccountID: 'payerBankAccountId_str',
            payeeBankAccountID: 'payeeBankAccountID_str',
            dev: 'dev_str',
            amount: 0,              // Must be > 0 for FedNow
            interactionType: 123,
            paymentMethod: 0,       // Must be === 0 for FedNow
        }

        const promotionInformation: PromotionInformation = {
            promoAmount: 1,         // Must be > 0 for PromoLedger 
        }

        const sqlTransactionID = 'sqlTransactionID_str'

        // TEST
        const idObj: IdObj = await executeStandardPTOperations(
            userPurchaseInformation, 
            promotionInformation, 
            sqlTransactionID,
        );

        // RESULTS

        // Verify id.Obj contains the correct IDs
        expect(idObj.primaryPaymentID).toBeDefined();
        expect(idObj.customerLedgerEntryID).toBeDefined();
        expect(idObj.pursTransactionID).toBeDefined();
        expect(idObj.primaryFedNowPaymentID).toBeUndefined();
        expect(idObj.promotionLedgerEntryID).toBeDefined();

        // Verify API calls have been called the correct number of times
        expect(RDS.executeStatement).toHaveBeenCalledTimes(3);
        expect(RDS.batchExecuteStatement).toHaveBeenCalledTimes(1);

        // Most test cases below are likely too detailed, but they do find a bug in the original espto.js.

        // Get each request passed into the mocked API calls
        let i: number = 0;
        const paymentRequest: ExecuteStatementRequest = AWS.executeStatementCalls[i++];
        const ledgerEntryRequest: ExecuteStatementRequest = AWS.executeStatementCalls[i++];
        const promoLedgerEntryRequest: ExecuteStatementRequest = AWS.executeStatementCalls[i++];
        const transactionRequest: BatchExecuteStatementRequest = AWS.batchExecuteStatementCalls[0];

        // Verify that each request contains the correct standard parameters
        testSingleStatementRequest(paymentRequest, idObj, userPurchaseInformation, sqlTransactionID);
        testSingleStatementRequest(ledgerEntryRequest, idObj, userPurchaseInformation, sqlTransactionID);
        testSingleStatementRequest(promoLedgerEntryRequest, idObj, userPurchaseInformation, sqlTransactionID);

        // Make sure payment status is correct
        testParameterDouble(paymentRequest.parameters!, 'paymentStatus', 4);
        testParameterString(paymentRequest.parameters!, 'datePaid', 
            new Date().toISOString().slice(0, 19).replace('T', ' '),
            false
        );

        // Verify that each request used the correct SQL query
        expect(paymentRequest.sql).toBe(INSERT_PAYMENT_SQL);
        expect(ledgerEntryRequest.sql).toBe(INSERT_LEDGER_ENTRY_SQL);
        expect(promoLedgerEntryRequest.sql).toBe(INSERT_PROMO_LEDGER_ENTRY_SQL);
        expect(transactionRequest.sql).toBe(INSERT_TRANSACTION_SQL);

        // Verify the contents of the transaction request.
        expect(transactionRequest.parameterSets?.length).toBe(2);

        // insertPayment
        testParameterBlob(transactionRequest.parameterSets?.[0]!, 'transactionId', idObj.pursTransactionID);
        testParameterBlob(transactionRequest.parameterSets?.[0]!, 'ledgerId', idObj.customerLedgerEntryID);

        // insertPromoLedger
        testParameterBlob(transactionRequest.parameterSets?.[1]!, 'transactionId', idObj.pursTransactionID);
        testParameterBlob(transactionRequest.parameterSets?.[1]!, 'ledgerId', idObj.promotionLedgerEntryID!);
    })

    test("No PromoLedger", async () => {

        // INPUT
        const userPurchaseInformation: UserPurchaseInformation = {
            payer: 'payer_str',
            payee: 'payee_str',
            payerBankAccountID: 'payerBankAccountId_str',
            payeeBankAccountID: 'payeeBankAccountID_str',
            dev: 'dev_str',
            amount: 1,              // Must be > 0 for FedNow
            interactionType: 123,
            paymentMethod: 0,       // Must be === 0 for FedNow
        }

        const promotionInformation: PromotionInformation = {
            promoAmount: 0,         // Must be > 0 for PromoLedger 
        }

        const sqlTransactionID = 'sqlTransactionID_str'

        // TEST
        const idObj: IdObj = await executeStandardPTOperations(
            userPurchaseInformation, 
            promotionInformation, 
            sqlTransactionID,
        );

        // RESULTS

        // Verify id.Obj contains the correct IDs
        expect(idObj.primaryPaymentID).toBeDefined();
        expect(idObj.customerLedgerEntryID).toBeDefined();
        expect(idObj.pursTransactionID).toBeDefined();
        expect(idObj.primaryFedNowPaymentID).toBeDefined();
        expect(idObj.promotionLedgerEntryID).toBeUndefined();

        // Verify API calls have been called the correct number of times
        expect(RDS.executeStatement).toHaveBeenCalledTimes(3);
        expect(RDS.batchExecuteStatement).toHaveBeenCalledTimes(1);

        // Most test cases below are likely too detailed, but they do find a bug in the original espto.js.

        // Get each request passed into the mocked API calls
        let i: number = 0;
        const paymentRequest: ExecuteStatementRequest = AWS.executeStatementCalls[i++];
        const fedNowRequest: ExecuteStatementRequest = AWS.executeStatementCalls[i++];
        const ledgerEntryRequest: ExecuteStatementRequest = AWS.executeStatementCalls[i++];
        const transactionRequest: BatchExecuteStatementRequest = AWS.batchExecuteStatementCalls[0];

        // Verify that each request contains the correct standard parameters
        testSingleStatementRequest(paymentRequest, idObj, userPurchaseInformation, sqlTransactionID);
        testSingleStatementRequest(fedNowRequest, idObj, userPurchaseInformation, sqlTransactionID);
        testSingleStatementRequest(ledgerEntryRequest, idObj, userPurchaseInformation, sqlTransactionID);

        // Make sure payment status is correct
        testParameterDouble(paymentRequest.parameters!, 'paymentStatus', 5);
        testParameterString(paymentRequest.parameters!, 'datePaid', undefined, true);

        // Verify that each request used the correct SQL query
        expect(paymentRequest.sql).toBe(INSERT_PAYMENT_SQL);
        expect(fedNowRequest.sql).toBe(INSERT_FED_NOW_PAYMENT_SQL);
        expect(ledgerEntryRequest.sql).toBe(INSERT_LEDGER_ENTRY_SQL);
        expect(transactionRequest.sql).toBe(INSERT_TRANSACTION_SQL);

        // Verify the contents of the transaction request.
        expect(transactionRequest.parameterSets?.length).toBe(1);

        // insertPayment
        testParameterBlob(transactionRequest.parameterSets?.[0]!, 'transactionId', idObj.pursTransactionID);
        testParameterBlob(transactionRequest.parameterSets?.[0]!, 'ledgerId', idObj.customerLedgerEntryID);
    })

    test("No FedNow or PromoLedger", async () => {

        // INPUT
        const userPurchaseInformation: UserPurchaseInformation = {
            payer: 'payer_str',
            payee: 'payee_str',
            payerBankAccountID: 'payerBankAccountId_str',
            payeeBankAccountID: 'payeeBankAccountID_str',
            dev: 'dev_str',
            amount: 0,              // Must be > 0 for FedNow
            interactionType: 123,
            paymentMethod: 0,       // Must be === 0 for FedNow
        }

        const promotionInformation: PromotionInformation = {
            promoAmount: 0,         // Must be > 0 for PromoLedger 
        }

        const sqlTransactionID = 'sqlTransactionID_str'

        // TEST
        const idObj: IdObj = await executeStandardPTOperations(
            userPurchaseInformation, 
            promotionInformation, 
            sqlTransactionID,
        );

        // RESULTS

        // Verify id.Obj contains the correct IDs
        expect(idObj.primaryPaymentID).toBeDefined();
        expect(idObj.customerLedgerEntryID).toBeDefined();
        expect(idObj.pursTransactionID).toBeDefined();
        expect(idObj.primaryFedNowPaymentID).toBeUndefined();
        expect(idObj.promotionLedgerEntryID).toBeUndefined();

        // Verify API calls have been called the correct number of times
        expect(RDS.executeStatement).toHaveBeenCalledTimes(2);
        expect(RDS.batchExecuteStatement).toHaveBeenCalledTimes(1);

        // Most test cases below are likely too detailed, but they do find a bug in the original espto.js.

        // Get each request passed into the mocked API calls
        let i: number = 0;
        const paymentRequest: ExecuteStatementRequest = AWS.executeStatementCalls[i++];
        const ledgerEntryRequest: ExecuteStatementRequest = AWS.executeStatementCalls[i++];
        const transactionRequest: BatchExecuteStatementRequest = AWS.batchExecuteStatementCalls[0];

        // Verify that each request contains the correct standard parameters
        testSingleStatementRequest(paymentRequest, idObj, userPurchaseInformation, sqlTransactionID);
        testSingleStatementRequest(ledgerEntryRequest, idObj, userPurchaseInformation, sqlTransactionID);

        // Make sure payment status is correct
        testParameterDouble(paymentRequest.parameters!, 'paymentStatus', 4);
        testParameterString(paymentRequest.parameters!, 'datePaid', 
            new Date().toISOString().slice(0, 19).replace('T', ' '),
            false
        );
        
        // Verify that each request used the correct SQL query
        expect(paymentRequest.sql).toBe(INSERT_PAYMENT_SQL);
        expect(ledgerEntryRequest.sql).toBe(INSERT_LEDGER_ENTRY_SQL);
        expect(transactionRequest.sql).toBe(INSERT_TRANSACTION_SQL);

        // Verify the contents of the transaction request.
        expect(transactionRequest.parameterSets?.length).toBe(1);

        // insertPayment
        testParameterBlob(transactionRequest.parameterSets?.[0]!, 'transactionId', idObj.pursTransactionID);
        testParameterBlob(transactionRequest.parameterSets?.[0]!, 'ledgerId', idObj.customerLedgerEntryID);
    })
})

/**
 * Verifys that an ExecuteStatementRequest contains all parameters, and that each parameter has been mapped to the 
 * correct variable.
 * Enforcing that each request contains the same parameters ensures that the parameters are always correct, and that any
 * necesarry changes to parameters are reflected in the SQL queries instead of the parameters. This will prevent any
 * possible confusion when using parameters in SQL queries.
 * @param request The request to be verified.
 * @param idObj The IdObj returned by executeStandardPTOperations.
 * @param userPurchaseInformation The UserPurchaseInformation passed into the executeStandardPTOperations.
 * @param sqlTransactionID The sqlTransactionID passed into the executeStandardPTOperations.
 */
function testSingleStatementRequest(request: ExecuteStatementRequest, idObj: IdObj, userPurchaseInformation: UserPurchaseInformation, sqlTransactionID: string) {
    // Verify all parameters besides the parameters array.
    testStatementRequest(request, sqlTransactionID);

    // Verify the parameters in the parameters array.
    // expect(request.parameters?.length).toBe(13);
    
    testParameterBlob(request.parameters!, 'payerId', userPurchaseInformation.payer);
    testParameterBlob(request.parameters!, 'payeeId', userPurchaseInformation.payee);
    testParameterBlob(request.parameters!, 'paymentId', idObj.primaryPaymentID);
    testParameterBlob(request.parameters!, 'ledgerId', idObj.customerLedgerEntryID);
    testParameterBlob(request.parameters!, 'developerId', userPurchaseInformation.dev);

    // Since idObj.primaryFedNowPaymentID is not guaranteed, make sure that the 'fedNowPaymentId' parameter exists, and 
    // if idObj.primaryFedNowPaymentID is defined, check that its value is used.
    // if (idObj.primaryFedNowPaymentID) {
    //     testParameterBlob(request.parameters!, 'fedNowPaymentId', idObj.primaryFedNowPaymentID!);
    // }
    // else {
    //     expect(request.parameters).toEqual(
    //         expect.arrayContaining([
    //             expect.objectContaining({ name: 'fedNowPaymentId' })
    //         ])
    //     );
    // }

    testParameterDouble(request.parameters!, 'paymentAmount', userPurchaseInformation.amount);
    testParameterDouble(request.parameters!, 'interactionTypeId', userPurchaseInformation.interactionType);
    testParameterDouble(request.parameters!, 'paymentMethod', userPurchaseInformation.paymentMethod);
    testParameterDouble(request.parameters!, 'paymentStatus', userPurchaseInformation.paymentMethod !== 0 || userPurchaseInformation.amount === 0 ? 4 : 5);

    // testParameterString(request.parameters!, 'payerAccountId', userPurchaseInformation.payerBankAccountID);
    // testParameterString(request.parameters!, 'payeeAccountId', userPurchaseInformation.payeeBankAccountID);
    testParameterString(request.parameters!, 'datePaid',
        userPurchaseInformation.paymentMethod === 0 && userPurchaseInformation.amount > 0 ? undefined : new Date().toISOString().slice(0, 19).replace('T', ' '),
        userPurchaseInformation.paymentMethod === 0 && userPurchaseInformation.amount > 0
    );
}

/**
 * Verifies parameters common to both ExecuteStatementRequest and BatchExecuteStatementRequest
 * @param request The request to be verified.
 * @param sqlTransactionID The sqlTransactionID passed into the executeStandardPTOperations.
 */
function testStatementRequest(request: ExecuteStatementRequest | BatchExecuteStatementRequest, sqlTransactionID: string) {
    expect(request.database).toBe(process.env.DATABASE);
    expect(request.secretArn).toBe(process.env.SECRET_ARN);
    expect(request.resourceArn).toBe(process.env.CLUSTER_ARN);
    expect(request.transactionId).toBe(sqlTransactionID);
}

/**
 * Verifies request parameters in blob format.
 * @param parameters The array of parameters from the request being verified.
 * @param name The name of the parameter to be verified.
 * @param value The expected value of the parameter.
 */
function testParameterBlob(parameters: SqlParameter[], name: string, value: string) {

    /*
    This test looks different from the rest because if the strategy used in testParameterString and testParameterDouble
    was used here, the test would always pass.
    */

    // Find the matching parameter.
    const payerVal: SqlParameter | undefined = parameters.find((parameter: SqlParameter) => {
        return parameter.name === name;
    })

    // Verify the value of the parameter.
    expect(payerVal?.value?.blobValue).toStrictEqual(structuredClone(Buffer.from(value, 'hex')));
}

/**
 * Verifies request parameters in string format.
 * @param parameters The array of parameters from the request being verified.
 * @param name The name of the parameter to be verified.
 * @param value The expected value of the parameter.
 * @param isNull Whether the value of the parameter is supposed to be undefined. (default: false)
 */
function testParameterString(parameters: SqlParameter[], name: string, value?: string, isNull?: boolean) {
    expect(parameters).toContainEqual({
        name: name,
        value: {
            stringValue: value,
            isNull: isNull,
        },
    });
}

/**
 * Verifies request parameters in double format.
 * @param parameters The array of parameters from the request being verified.
 * @param name The name of the parameter to be verified.
 * @param value The expected value of the parameter.
 */
function testParameterDouble(parameters: SqlParameter[], name: string, value: BoxedDouble) {
    expect(parameters).toContainEqual({
        name: name,
        value: {
            doubleValue: value,
        },
    });
}