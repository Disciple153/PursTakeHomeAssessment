- `executeStandardPTOperations()` returns an object with the ids of every transaction that was made.
- ledgerEntries is not supposed to contain `primaryFedNowPaymentID`, and insertTransaction will not record it.
  - primaryFedNowPaymentID
- `payor` is a typo. it shoud be `payer`
- `ledgeEntries` is a typo. It should be `ledgerEntries`
- The line `blobValue: Buffer.from(dev, 'hex')` is a bug. It should be `blobValue: Buffer.from(payer, 'hex')`
