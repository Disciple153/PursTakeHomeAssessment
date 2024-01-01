The following is a function written in node.js called `executeStandardPTOperations`, of which "PT" stands for "Purs transaction". Your task is to 
1) refactor it, and 
2) write a unit test to test it. 

It is stateless, except for the calls to `RDS` to insert records. 

A few items to note: 
- This code was functional when it was retired, so there are no bugs we are *expecting* you to find. If you find a bug, that's good - make a note of it and fix it! Note, however, that you will likely have to do some mocking to get this function to run locally. 
- You'll notice some variables are not defined, such as `insertfedNowPaymentSQL`, among others. These are constants that you can ignore, or define at the top of the file to contain whatever you want. 
- You can (and should) mock the calls to RDS.
- "refactor" in this case should mean that this code is more readable, maintainable, testable, understandable, commented, etc. If you notice any anti-patterns, sloppiness, or potential bugs, fix them (and make a note)!
	- also, if you see room to optimize for latency, go for it. 
- Take any creative freedoms you like. One exception: if you want to switch the language this is written in, it must be Golang or a JS framework. 
- State all assumptions at the top of the file in a comment or a separate markdown file. 
- Use any framework for writing your unit test. Try to cover all test cases. 

Your work will be evaluated based on how cleanly you can refactor this function: readability, maintainability, testability, errors/bugs, etc. Your unit test will be evaluated based on their readability and coverage. Put in other words, your unit tests should fail if significant logic changes are made to the function, and it should be fairly easy to read the unit tests and understand the test cases. 