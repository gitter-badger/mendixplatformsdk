/*
The MIT License (MIT)

Copyright (c) 2015 Mendix

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

/// <reference path='./typings/tsd.d.ts' />

import {MendixSdkClient, Project, Revision, Branch, OnlineWorkingCopy} from 'mendixplatformsdk';
import {IModel, domainmodels, projects} from 'mendixmodelsdk';

import when = require('when');
import chai = require('chai');
var expect = chai.expect;
var assert = chai.assert;
var should = chai.should();
chai.use(require('chai-string'));
var chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);

const projectId = `ef03c9be-278c-486f-b36c-b1a7b0740ea8`;
const projectName = `Roundtrip Integration`;

describe('MendixSdkClient credentials', function() {
	it('should throw for null username', () => {
		expect(() => new MendixSdkClient(null)).to.throw('Incomplete credentials');
	});
	it('should throw for null apikey', () => {
		expect(() => new MendixSdkClient('some username', null)).to.throw('Incomplete credentials');
	});
	it('should throw for null password if apikey is also null', () => {
		expect(() => new MendixSdkClient('some username', null, null)).to.throw('Incomplete credentials');
	});
	it('should throw for null openid if apikey is also null', () => {
		expect(() => new MendixSdkClient('some username', null, 'some password', null)).to.throw('Incomplete credentials');
	});
});

interface MendixSdkClientConfig {
	username?: string;
	apiKey?: string;
	password?: string;
	openId?: string;
	projectsApiEndpoint?: string;
	modelApiEndpoint?: string;
}

function createMendixSdkClient(config: MendixSdkClientConfig): MendixSdkClient {
	const defaultConfig: MendixSdkClientConfig = {
		username: 'richard.ford51@example.com',
		apiKey: '364fbe6d-c34d-4568-bb7c-1baa5ecdf9d1',
		password: null,
		openId: null,
		projectsApiEndpoint: 'https://sprintr.home.mendix.dev',
		modelApiEndpoint: 'https://model-api.mendix.dev'
	};
	return new MendixSdkClient(
		config.username ? config.username : defaultConfig.username,
		config.apiKey ? config.apiKey : defaultConfig.apiKey,
		config.password ? config.password : defaultConfig.password,
		config.openId ? config.openId : defaultConfig.openId,
		config.projectsApiEndpoint ? config.projectsApiEndpoint : defaultConfig.projectsApiEndpoint,
		config.modelApiEndpoint ? config.modelApiEndpoint : defaultConfig.modelApiEndpoint
	);
}

// Create a 'client' object to interact with Platform APIs.
let client = createMendixSdkClient({});
let clientWithInvalidApiKey = createMendixSdkClient({
	apiKey: 'Undoubtedly wrong API Key'
});
let clientWithInvalidHost = createMendixSdkClient({
	projectsApiEndpoint: 'https://sprintr.home.mendix.dev.invalid'
});
let clientWithInvalidEndPoint = createMendixSdkClient({
	projectsApiEndpoint: 'https://sprintr.home.mendix.dev/invalid'
});

describe('create new app', function() {
	this.timeout(50000);

	const projectName = `mySdkProject`;
	const longProjectName = `This is a really long name that no one will actually do this at all 123456!!`;
	const nonEmptyProjectSummary = `non-empty summary`;

	it('should just work', () => {
		return client.platform().createNewApp(projectName, nonEmptyProjectSummary)
			.should.eventually.have.property(`_name`, projectName);
	});
	it('should succeed with empty summary', () => {
		return client.platform().createNewApp(projectName)
			.should.eventually.have.property(`_name`, projectName);
	});
	it('should succeed with long project name and summary', () => {
		return client.platform().createNewApp(longProjectName)
			.should.eventually.have.property(`_name`, longProjectName);
	});
	it('should fail because project name is empty', () => {
		return client.platform().createNewApp(null)
			.should.eventually.be.rejectedWith(`Project name cannot be empty`);
	});
	it('should fail because it contains invalid characters', () => {
		return client.platform().createNewApp('/?mySdkProject', nonEmptyProjectSummary).should.eventually.be.rejectedWith(`Project name cannot contain`);
	});
	it('should fail because of invalid API key', () => {
		return clientWithInvalidApiKey.platform().createNewApp(projectName, nonEmptyProjectSummary).should.eventually.be.rejectedWith(`Invalid username and/or API key`);
	});
	it('should fail because of invalid hostname', () => {
		return clientWithInvalidHost.platform().createNewApp(projectName, nonEmptyProjectSummary).should.eventually.be.rejectedWith(`Connection error`);
	});
	it('should fail because of invalid endpoint', () => {
		return clientWithInvalidEndPoint.platform().createNewApp(projectName, nonEmptyProjectSummary).should.eventually.be.rejectedWith(`404 Not Found`);
	});
});


const roundTripProject = new Project(client, projectId, projectName);

const mainLineOnRoundTrip = new Branch(roundTripProject, null);
const nonExistentBranchOnRoundTrip = new Branch(roundTripProject, "Non-existentBranch"); //including a space in the branch name will cause issue in the assertion due to encoding

const validRevisionOnMainLineOnRoundTrip = new Revision(3, mainLineOnRoundTrip);
const invalidRevisionOnMainLineOnRoundTrip = new Revision(999, mainLineOnRoundTrip);
const revisionOnNonExistentBranch = new Revision(-1, nonExistentBranchOnRoundTrip);

const nonExistentProject = new Project(client, `Random non-existent id`, `empty`);
const mainLineOnNonExistentProject = new Branch(nonExistentProject, null);
const revisionOnNonExistentProject = new Revision(3, mainLineOnNonExistentProject);

describe('expose working copy', function() {

	this.timeout(50000);
	it('should succeed with an existing project', () => {
		return client.platform().createOnlineWorkingCopy(roundTripProject, validRevisionOnMainLineOnRoundTrip)
			.should.eventually.be.fulfilled;
	});
	it('should fail because project does not exist', () => {
		return client.platform().createOnlineWorkingCopy(nonExistentProject, revisionOnNonExistentProject)
			.should.eventually.be.rejectedWith("Project does not exist");
	});
	it('should fail because revision does not exist', () => {
		return client.platform().createOnlineWorkingCopy(roundTripProject, invalidRevisionOnMainLineOnRoundTrip)
			.should.eventually.be.rejectedWith("No such revision");
	});
	it('should fail because branch does not exist', () => {
		return client.platform().createOnlineWorkingCopy(roundTripProject, revisionOnNonExistentBranch)
			.should.eventually.be.rejectedWith(`${nonExistentBranchOnRoundTrip.name() }' doesn't exist`); //yes, the quote is asymmetric, it's deliberate
	});
	it('should fail because API Keys is invalid', () => {
		return clientWithInvalidApiKey.platform().createOnlineWorkingCopy(roundTripProject, validRevisionOnMainLineOnRoundTrip)
			.should.eventually.be.rejectedWith(`Invalid username and/or API key`);
	});
	it('should fail because of invalid hostname', () => {
		return clientWithInvalidHost.platform().createOnlineWorkingCopy(roundTripProject, validRevisionOnMainLineOnRoundTrip)
			.should.eventually.be.rejectedWith(`Connection error`);
	});
	it('should fail because of invalid endpoint', () => {
		return clientWithInvalidEndPoint.platform().createOnlineWorkingCopy(roundTripProject, validRevisionOnMainLineOnRoundTrip)
			.should.eventually.be.rejectedWith(`404 Not Found`);
	});
});

describe('commit to teamserver', function() {
	this.timeout(50000);
	const invalidProject = new Project(client, `WhateverId`, `WhateverName`);
	const revisionOnInvalidProject = new Revision(-1, new Branch(invalidProject, null));
	const nonExistentWorkingCopy = new OnlineWorkingCopy(client, `Obviously does not exist`, revisionOnInvalidProject, null);
	const nonExistentBranchName = `Non-existentBranch`;

	// before((done) => {

	// //TODO: This is the test that we want to use once the unzipping issue is solved
	// 	//const project = new Project(client, "12bcb33e-ad43-463a-8c34-a67c729a7997", projectName); //production
	// 	const project = new Project(client, "eaa2fbce-c273-473a-921a-354463cf37f0", "mySdkProject"); //mxlab
	// 	const branch = new Branch(project, null);
	// 	const revision = new Revision(2, branch);
	// 	client.platform().createOnlineWorkingCopy(project, revision)
	// 		.done(
	// 			(wc) => {
	// 				workingCopy = wc;
	// 				done();
	// 			},
	// 			(reason) => {
	// 				throw (`Unable to create working copy. Cannot execute any tests in 'commit to teamserver' suite: ${reason}`);
	// 			});
	// });

	describe('with a newly created project and working copy', () => {
		let sharedProject: Project;
		let workingCopy: OnlineWorkingCopy;
		before((mochaDone) => {
			client.platform().createNewApp('TestApp').done(
				(project) => {
					sharedProject = project;
					mochaDone();
				},
				(reason) => {
					throw (`Unable to create project. Cannot execute any tests in this suite: ${reason}`);
				});
		});
		beforeEach((mochaDone) => {
			sharedProject.createWorkingCopy().done(
				(wc) => {
					workingCopy = wc;
					mochaDone();
				},
				(reason) => {
					throw (`Unable to create working copy. Cannot execute any tests in this suite: ${reason}`);
				});
		});
		it('should succeed with default commit parameters', () => {
			return workingCopy.commit().should.eventually.be.fulfilled;
		});
		it('should succeed with branch commit parameter retrieved from workingCopy', () => {
			return workingCopy.commit(workingCopy.sourceRevision().branch().name()).should.eventually.be.fulfilled;
		});
		it('should succeed with branch and revision commit parameters from workingCopy', () => {
			let branchName = workingCopy.sourceRevision().branch().name();
			let revisionNr = workingCopy.sourceRevision().num();
			return workingCopy.commit(branchName, revisionNr).should.eventually.be.fulfilled;
		});
		it(`should fail because branch does not exist`, () => {
			return workingCopy.commit(nonExistentBranchName).should.eventually.be.rejectedWith(`${nonExistentBranchName}' doesn't exist`);
		});
		it('should fail because revision is invalid', () => {
			return client.platform().commitToTeamServer(workingCopy, workingCopy.sourceRevision().branch().name(), -2).should.eventually.be.rejectedWith(`Invalid base revision`);
		});
		it('should fail because API Keys is invalid', () => {
			return clientWithInvalidApiKey.platform().commitToTeamServer(workingCopy).should.eventually.be.rejectedWith(`Invalid username and/or API key`);
		});
		it('should fail because of invalid hostname', () => {
			return clientWithInvalidHost.platform().commitToTeamServer(workingCopy).should.eventually.be.rejectedWith(`Connection error`);
		});
		it('should fail because of invalid endpoint', () => {
			clientWithInvalidEndPoint.platform().commitToTeamServer(workingCopy).should.eventually.be.rejectedWith(`404 Not Found`)
		});
	});

	it('should fail because working copy does not exist', () => {
		return client.platform().commitToTeamServer(nonExistentWorkingCopy).should.eventually.be.rejectedWith(`Project does not exist`);
	});

	it(`should succeed with some changes in the model`, () => {
		return client.platform().createNewApp('TestModelChange')
			.then(project => project.createWorkingCopy())
			.then((updateModel))
			.then((wc) => {
				return wc.commit();
			}).then((revision) => {
				return revision.num();
			}).should.eventually.equal(3);
	});
	it(`should succeed with two commits`, () => {
		return client.platform().createNewApp('TestDoubleCommit')
			.then(project => project.createWorkingCopy())
			.then((updateModel))
			.then((workingCopy) => workingCopy.commit())
			.then(revision => revision.createWorkingCopy())
			.then((updateModel))
			.then((workingCopy) => {
				return workingCopy.commit();
			}).then((revision) => {
				return revision.num();
			}).should.eventually.equal(4);
	});
	it('should fail because revision is outdated', () => {
		return client.platform().createNewApp('TestOutdatedCommit', 'nothing')
			.then(project => project.createWorkingCopy())
			.then((updateModel))
			.then((workingCopy) => workingCopy.commit())
			.then(revision => revision.createWorkingCopy())
			.then((updateModel))
			.then((workingCopy) => {
				return workingCopy.commit(null, 2);
			}).should.eventually.be.rejectedWith(`Working copy is not up-to-date`);
	});
});

function updateModel(wc: OnlineWorkingCopy): OnlineWorkingCopy {
	const project = wc.model().root;
	const mod = new projects.Module(project);
	mod.name = `NewModule_${Date.now() }`;
	project.modules.push(mod);
	return wc;
}

/*
 *
 * MENDIX SDK DEVELOPER CODE
 *
 */

if (false) {
	let projectName = `project`;
	let branchName = null;

	// Retrieve all my projects
	client.retrieveProjects()
		.then(projects => {
			// Find the 'Sprintr' project
			let sprintr = projects.filter(p => p.name() === projectName)[0];

			// Take HEAD/latest revision from trunk/main line and import into new model server working copy
			return sprintr.createWorkingCopy();
		})
		.then(manipulateModel)
		.then(workingCopy => {
			// After successful manipulation, commit changes back to the teamserver.
			return workingCopy.commit();
		})
		.done(revision => {
			console.log('Successfully committed changes as revision %d on branch %s', revision.num(), revision.branch().name());
		}, errorHandler);

	client.retrieveProjects()
		.then(projects => projects.filter(p => p.name() === projectName)[0])
		.then(project => project.retrieveBranches())
		.then(branches => branches.filter(b => b.name() === branchName)[0])
		.then(branch => branch.retrieveRevisions())
		.then(revisions => revisions.reduce((prev: Revision, cur: Revision) => prev.num > cur.num ? prev : cur))
		.then(revision => revision.createWorkingCopy())
		.then(workingCopy => {
			// Do changes ...
			return workingCopy;
		})
		.then(workingCopy => {
			// Then commit ...
			return workingCopy.commit(/*CommitStyle.CreateBranch*/);
		})
		.done(revision => {
			// Deploy ...
			revision.deploy(
				(deploymentInfo) => console.log('Successfully deployed your app on %s', deploymentInfo.applicationUrl()),
				errorHandler);
		}, errorHandler);

	function manipulateModel(workingCopy: OnlineWorkingCopy): when.Promise<OnlineWorkingCopy> {
		return when.promise<OnlineWorkingCopy>((resolve, reject) => {
			// Use 'workingCopy.model()' to get access to the model stored in the working copy so that you can analyze/manipulate your model:
			workingCopy.model().allMicroflows().forEach(mf => {
				console.log('Found microflow: %s', mf.qualifiedName);

				let module = workingCopy.model().allModules().filter(m => m.name === 'MyFirstModule')[0];
				module.domainModel.load(domainModel => {
					let entity = new domainmodels.Entity();
					entity.name = 'Customer';
					// etc.

					domainModel.entities.push(entity);

					resolve(workingCopy);
				});
			});
		});
	}

	/**
	 * Generic error handler that exits the script after printing error details.
	 */
	function errorHandler(error): void {
		console.log('Something went wrong:');
		console.log(error);

		process.exit(1);
	}

}
