# Contents:

## espto.ts

This is the refactored espto.js.

The structure has been changed so that parameters are all defined in advance, and then each query is submitted if appropriate.
My reasoning for defining all parameters in advance is that It reduces confusion surrounding what each aprameter does.
If a parameter should change between queries, I think it makes more sense to reflect that in the query rather than in the parameters.

## espto.test.ts

This is the test suite for espto.ts.

It tests all cases, ensures that queries were submitted in the correct order, and ensures that parameters were all mapped correctly from the input.

## minimalchanges.ts

This is the original espto.js, but with only the necesarry changes required to run the test suite.

One bug has been fixed: The `datePaid` parameter was able to be null, but `SqlParameter` only expects `stringValue` to be `string` or `undefined`.

All other bugs and test breaking behavior have been left unchanged.

## minimalchanges.test.ts

This is a copy of espto.test.ts, but it tests minimalchanges.ts instead.

A few test cases have been commented out so that the test suite can function despite the lack of refactoring.
You will notice that upon running minimalchanges.test.ts, two tests will fail when checking the `payerId` parameter from the `promoLedgerEntryRequest`.
This failure shows that instead of using the `userPurchaseInformation.payer` for the `payerId`, the original function used `userPurchaseInformation.dev`.

# assumpthons.md

This is a list of the assumptions I made while working on this assessment.

# Running tests

```bash
npm install
npm test
```
