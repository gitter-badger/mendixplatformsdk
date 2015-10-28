Run the build script:

	npm run build

Run all the tests:

	mocha

Run specific tests:

	mocha --grep "{filter criteria}"

Note: grep will look into the name given in the "describe" and "it". We can also combine them and do something like "mocha --grep 'commit to teamserver should succeed'"
