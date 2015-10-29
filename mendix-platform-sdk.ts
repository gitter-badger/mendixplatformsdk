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

/// <reference path="./typings/tsd.d.ts" />
import {ModelSdkClient, IModel, configuration, domainmodels, microflows} from "mendixmodelsdk";

import fs = require("fs");
import path = require("path");
import when = require("when");

import _ = require("lodash");

import rest = require("rest");
import interceptor = require("rest/interceptor");
import pathPrefix = require("rest/interceptor/pathPrefix");
import errorCode = require("rest/interceptor/errorCode");

import xml2js = require("xml2js");
import jsonpath = require("jsonpath");

/**
 * The state of the background job:
 *
 * - Running: the job has been submitted for execution
 * - Completed: the job has been successfully completed
 * - Failed: the job has finished with an error
 */
export enum JobState {
	Running,
	Completed,
	Failed
}

// http://stackoverflow.com/questions/12915412/how-do-i-extend-a-host-object-e-g-error-in-typescript
declare class Error implements Error {
	public name: string;
	public message: string;
	constructor(message?: string);
}

class EmptyError extends Error {
	name: string;
	message: string;
	constructor(message?: string) {
		super(message);
		this.message = message;
	}
}

class ParseError extends Error {
	name: string;
	message: string;
	constructor(message?: string) {
		super(message);
		this.message = message;
	}
}

interface RequestContents {
	path: string;
	method: string;
	headers: Object;
	entity: string;
	mixin: Object;
}

/**
 * Client class that provides access to all Platform and Model APIs.
 */
export class MendixSdkClient {
	private _platformSdkClient: PlatformSdkClient;
	private _modelSdkClient: ModelSdkClient;

	private static DEFAULT_MODELAPI_ENDPOINT = `https://model-api.cfapps.io`;
	private static DEFAULT_PROJECTSAPI_ENDPOINT = `https://sprintr.home.mendix.com`;

	/**
		 * Create a new client to access [Mendix](developer.mendix.com) Platform and Model APIs.
		 *
		 * @param username Username of your account (same as username used to log in to the Mendix Development Portal)
		 * @param apikey API key for your account.
		 */
	constructor(username: string, apikey?: string, password?: string, openid?: string, projectsApiEndpoint?: string, modelApiEndpoint?: string) {
		let credentials: configuration.IBackendCredentials | configuration.ISdkCredentials;

		if (apikey) {
			credentials = {
				username: username,
				apikey: apikey
			}
		} else if (password && openid) {
			credentials = {
				username: username,
				password: password,
				openid: openid
			}
		} else {
			throw new Error(`Incomplete credentials`);
		}

		this._modelSdkClient = new ModelSdkClient({
			credentials: credentials,
			endPoint: modelApiEndpoint ? modelApiEndpoint : MendixSdkClient.DEFAULT_MODELAPI_ENDPOINT
		});

		this._platformSdkClient = new PlatformSdkClient(this, username, apikey,
			projectsApiEndpoint ? projectsApiEndpoint : MendixSdkClient.DEFAULT_PROJECTSAPI_ENDPOINT);
	}

	platform(): PlatformSdkClient {
		return this._platformSdkClient;
	}

	model(): ModelSdkClient {
		return this._modelSdkClient;
	}

	/**
	* Retrieve all your Mendix App projects.
	*
	* @returns An array of Project instances that each represent one of your Mendix Platform projects.
	*/
	retrieveProjects(): when.Promise<Project[]> {
		return this._platformSdkClient.retrieveProjects(this);
	}
}

// Internal (similar to the Model API 'SdkClient')
export class PlatformSdkClient {
	private _client: MendixSdkClient;
	private _username: string;
	private _apikey: string;
	private _projectsApiEndpoint: string;
	private _xmlParser: xml2js.Parser;

	private static PROJECTS_API_PATH = `/ws/ProjectsAPI/9/soap1`;

	private static HTTP_STATUS_OK_RESPONSE_CODE = 200;
	private static HTTP_STATUS_WS_ERROR_RESPONSE_CODE = 500;

	private static CreateNewAppXml = PlatformSdkClient._templatePath(`CreateNewApp.xml`);
	private static CreateOnlineWorkingCopyXml = PlatformSdkClient._templatePath(`CreateOnlineWorkingCopy.xml`);
	private static CommitWorkingCopyChangesXml = PlatformSdkClient._templatePath(`CommitWorkingCopyChanges.xml`);
	private static RetrieveJobStatusXml = PlatformSdkClient._templatePath(`RetrieveJobStatus.xml`);

	constructor(client: MendixSdkClient, username: string, apikey: string, projectsApiEndpoint: string) {
		this._client = client;
		this._username = username;
		this._apikey = apikey;
		this._xmlParser = new xml2js.Parser();
		this._projectsApiEndpoint = projectsApiEndpoint;
	}

	/**
	* Creates a new app and commits it to the Team Server.
	*
	* @param projectName The name of the new app
	* @param projectSummary (Optional) A short description of the new app
	* @returns a Promise of a Mendix App Project
	*/
	createNewApp(projectName: string, projectSummary?: string): when.Promise<Project> {
		console.log(`Creating new project with name ${projectName} for user ${this._username}...`);

		const contents = this._createRequestContent(PlatformSdkClient.CreateNewAppXml, {
			"ProjectName": projectName,
			"ProjectSummary": projectSummary,
			"User": this._username,
			"ApiKey": this._apikey
		});

		const apiClient = rest
			.wrap(this._createHttpErrorCodeInterceptor(`Failed to create new app`))
			.wrap(this._parseResult())
			.wrap(pathPrefix, { prefix: this._projectsApiEndpoint });

		return apiClient(contents)
			.then(response => {
				const jobId: string = response.entity;

				console.log(`Project creation for user ${this._username} underway with job id: ${jobId}...`);

				return this._awaitJobResult(jobId);
			})
			.then(jobResult => {
				console.log(`Project created successfully for user ${this._username} with id ${jobResult.result}`);
				return new Project(this._client, jobResult.result, projectName);
			});
	}

	/**
	* TODO: implementation
	*/
	retrieveProjects(client: MendixSdkClient): when.Promise<Project[]> {
		console.log(`Retrieving projects for user ${this._username}...`);

		// TODO: Implement this properly, including templating of the entity
		let apiClient = rest.wrap(pathPrefix, { prefix: this._projectsApiEndpoint });
		return apiClient({
			path: PlatformSdkClient.PROJECTS_API_PATH,
			method: `POST`,
			entity: null // TODO: templating
		}).then(response => {
			// TODO: Extract raw list of projects from response entity.
			let rawProjects: [{}] = response.entity;

			// TODO: Return a mapping of each raw project to a nicely typed representation.
			let projects = rawProjects.map(raw => new Project(client, 'TODO-ID', 'Sprintr'));

			console.log('Retrieved projects for user %s: %s', this._username, projects.map(p => p.id() + ':' + p.name()).join(', '));

			return projects;
		});
	}

	/**
	* TODO: implementation
	*/
	retrieveBranches(project: Project): when.Promise<Branch[]> {
		console.log('Retrieving branches for project %s : %s', project.id(), project.name());
		return when.promise<Branch[]>((resolve, reject) => {
			// TODO: Retrieve available branches from the Platform API
			let branches: Branch[] = [];

			console.log('Successfully retrieved branches for project %s : %s : %s', project.id(), project.name(), branches.map(b => b.name).join(', '));
			resolve(branches);
		});
	}

	/**
	* Expose a specific Team Server revision as an Online Working Copy.
	*
	* @param project an instance of a Mendix App Project
	* @param revision A Revision instance pointing to a revision number on a specific Team Server branch
	* @returns a Promise of an OnlineWorkingCopy in the Mendix Model Server corresponding to the given project and revision.
	*/
	createOnlineWorkingCopy(project: Project, revision: Revision): when.Promise<OnlineWorkingCopy> {
		console.log(`Creating new online working copy for project ${project.id() } : ${project.name() }`);

		const request = this._createRequestContent(PlatformSdkClient.CreateOnlineWorkingCopyXml, {
			"Username": this._username,
			"ApiKey": this._apikey,
			"ProjectId": project.id(),
			"Branch": revision ? revision.branch().name() : null,
			"Revision": revision ? revision.num() : null
		});

		const apiClient = rest
			.wrap(this._createHttpErrorCodeInterceptor(`Failed to create online working copy`))
			.wrap(this._parseResult())
			.wrap(pathPrefix, { prefix: this._projectsApiEndpoint });

		return apiClient(request)
			.then(response => {
				const jobId: string = response.entity;

				return this._awaitJobResult(jobId);
			})
			.then(jobResult => {
				const wcId: string = jobResult.result;

				console.log('Successfully created new online working copy %s for project %s : %s', wcId, project.id(), project.name());

				return when.promise<OnlineWorkingCopy>((resolve, reject) => {
					this._client.model().openWorkingCopy(wcId,
						(model: IModel) => {
							console.log(`Successfully opened new online working copy ${wcId} for project ${project.id() } : ${project.name() }`);
							const rev: Revision = revision ? revision : new Revision(-1, new Branch(project, null));
							const workingCopy: OnlineWorkingCopy = new OnlineWorkingCopy(this._client, wcId, rev, model);

							resolve(workingCopy);
						},
						error => {
							console.error('Failed to open new online working copy %s for project %s : %s:', wcId, project.id(), project.name());

							reject(error);
						});
				});
			});
	}

	/**
	* Commit changes in your Online Working Copy to your model back to the Team Server.
	*
	* @param workingCopy an OnlineWorkingCopy instance pointing to a working copy on the Mendix Model server.
	* @param branchName (Optional) The name of the branch to commit to, or null for main line. Default is null.
	* @param baseRevision (Optional) The base revision for this commit, or -1 for HEAD. Default is -1.
	* @returns a Promise of a Team Server Revision corresponding to the given workingCopy.
	*/
	commitToTeamServer(workingCopy: OnlineWorkingCopy, branchName: string = null, baseRevision: number = -1): when.Promise<Revision> {
		if (workingCopy == null || workingCopy.project() == null) {
			return when.reject<Revision>(`Working copy is empty or does not contain referral to project`);
		} else if (baseRevision < -1) {
			return when.reject<Revision>(`Invalid base revision ${baseRevision}`);
		}

		console.log(`Committing changes in online working copy ${workingCopy.id() } to team server project ${workingCopy.project().id() } branch ${branchName} base revision ${baseRevision}`);

		const request = this._createRequestContent(PlatformSdkClient.CommitWorkingCopyChangesXml, {
			"Username": this._username,
			"ApiKey": this._apikey,
			"WorkingCopyId": workingCopy.id(),
			"ProjectId": workingCopy.project().id(),
			"Branch": branchName,
			"Revision": baseRevision
		});

		const apiClient = rest
			.wrap(this._createHttpErrorCodeInterceptor(`Failed to commit to team server`))
			.wrap(this._parseResult())
			.wrap(pathPrefix, { prefix: this._projectsApiEndpoint });

		return apiClient(request)
			.then(response => {
				const jobId: string = response.entity;

				return this._awaitJobResult(jobId);
			})
			.then(jobResult => {
				return when.promise<Revision>((resolve, reject) => {

					const num: number = parseInt(jobResult.result);

					if (num == null) {
						reject(`Failed to commit changes to team server: revision ${num} on branch ${branchName}. Reason: returned job id is not a number.`);
					} else {
						console.log(`Successfully committed changes to team server: revision ${num} on branch ${branchName}`);

						const branch: Branch = new Branch(workingCopy.project(), branchName);
						const revision: Revision = new Revision(num, branch);

						resolve(revision);
					}
				});
			});
	}

	private _awaitJobResult(jobId: string): when.Promise<JobResult> {
		return when.promise<JobResult>((resolve, reject) => {
			setTimeout(() => {
				const request = this._createRequestContent(PlatformSdkClient.RetrieveJobStatusXml, { "JobId": jobId });

				const client = rest
					.wrap(this._createHttpErrorCodeInterceptor('Error when retrieving job status'))
					.wrap(this._parseJobStatus())
					.wrap(pathPrefix, { prefix: this._projectsApiEndpoint });

				client(request).done(response => {
					let state: string = response.entity.state;
					if (JobState[state] === JobState.Completed) {
						resolve(response.entity);
					} else if (JobState[state] === JobState.Failed) {
						reject(response.entity.errorMessage);
					} else { // JobState.Running
						this._awaitJobResult(jobId).done(resolve, reject);
					}
				}, reject);
			}, 1000);
		});
	}

	private _createRequestContent(template: string, data: Object): RequestContents {
		const payload = this._compilePayload(template, data);

		return {
			path: PlatformSdkClient.PROJECTS_API_PATH,
			method: 'POST',
			headers: {
				'Content-Type': 'text/xml;charset=UTF-8'
			},
			mixin: {},
			entity: payload
		};
	}

	private _compilePayload(template: string, data: Object): string {
		const xmlPayloadTemplate = fs.readFileSync(template, 'utf8');
		const compileXmlPayload = _.template(xmlPayloadTemplate);

		const payload = compileXmlPayload(data);

		return payload;
	}

	private _parseResult(): rest.Interceptor<{}> {
		return interceptor({
			success: (response, config, meta) => {
				if (_.isEmpty(response.entity)) {
					return when.reject<any>('Error: HTTP response entity missing');
				} else {
					return this._parseAndQuery(response.entity, '$..Result[0]')
						.then(result => {
							response.entity = result;
							return response;
						});
				}
			}
		});
	}

	private _parseJobStatus(): rest.Interceptor<{}> {
		return interceptor({
			success: (response, config, meta) => {
				if (_.isEmpty(response.entity)) {
					return when.reject<any>(`Error: HTTP response entity missing`);
				} else {
					return when.promise<rest.Response>((resolve, reject) => {
						xml2js.parseString(response.entity, (error, parsed) => {
							if (error) {
								console.error(`Something went wrong: ${error}`);
								reject(error);
							} else {
								response.entity = this._parseJobResult(parsed);
								resolve(response);
							}
						});
					});
				}
			}
		});
	}

	private _parseJobResult(parsed): JobResult {
		let jobId = jsonpath.query(parsed, '$..JobId[0]')[0];
		let startTime = jsonpath.query(parsed, '$..StartTime[0]')[0];
		let endTime = jsonpath.query(parsed, '$..EndTime[0]')[0];
		let state = jsonpath.query(parsed, '$..State[0]')[0];
		let result = jsonpath.query(parsed, '$..Result[0]')[0];
		let errorMessage = jsonpath.query(parsed, '$..ErrorMessage[0]')[0];

		return {
			jobId: jobId,
			startTime: startTime,
			endTime: endTime,
			state: state,
			result: result,
			errorMessage: errorMessage
		};
	}

	private _parseAndQuery(xml: string, query: string): when.Promise<string> {
		this._xmlParser.reset();

		let valPromise = when.promise<string>((resolve, reject) => {
			this._xmlParser.parseString(xml, (err, result) => {
				if (err) {
					let error: ParseError = new ParseError(err);
					reject(error);
				} else {
					let parseResult = jsonpath.query(result, query)[0];
					if (_.isEmpty(parseResult)) {
						let error: EmptyError = new EmptyError(`Query ${query} on ${parseResult} does not give any result`);
						reject(error);
					} else {
						resolve(parseResult);
					}
				}
			});
		});

		return valPromise;
	}

	private _createHttpErrorCodeInterceptor(errorMessage: string): rest.Interceptor<{}> {
		let response = response => {
			return when.promise<rest.Response>((resolve, reject) => {
				if (response.error) {
					reject(`Connection error: ${response.error}`);
				} else if (_.isEmpty(response.status) || _.isEmpty(response.entity)) {
					reject(`Error: invalid HTTP response`);
				} else if (response.status.code === PlatformSdkClient.HTTP_STATUS_OK_RESPONSE_CODE) {
					resolve(response);
				} else if (response.status.code === PlatformSdkClient.HTTP_STATUS_WS_ERROR_RESPONSE_CODE) {
					this._parseAndQuery(response.entity, '$..faultstring[0]')
						.done(
						(cause) => {
							reject(`${errorMessage}: ${cause}`);
						},
						(error) => {
							reject(error);
						});
				} else {
					reject(`Unexpected HTTP response code: ${response.status.code} ${response.raw.response.statusMessage}. Please retry after a few minutes. If the problem persists, please consult https://mxforum.mendix.com`);
				}
			});
		};

		return interceptor({
			response: response
		});
	}

	private static _templatePath(filename: string): string {
		return path.join(__dirname, 'templates', filename);
	}
}

interface JobResult {
	jobId: string;
	startTime: string;
	endTime: string;
	state: string;
	result: string;
	errorMessage: string;
}

/**
 * Representation of a Mendix App Project
 */
export class Project {
	private _client: MendixSdkClient;

	private _id: string;
	private _name: string;

	/**
	* @param client a MendixSdkClient instance
	* @param id Project id returned by the Mendix Projects API
	* @param name The desired project name
	*/
	constructor(client: MendixSdkClient, id: string, name: string) {
		this._client = client;
		this._id = id;
		this._name = name;
	}

	/**
		 * @returns ID of this Project
		 */
	id(): string {
		return this._id;
	}

	/**
		 * @returns name of this Project
		 */
	name(): string {
		return this._name;
	}

	retrieveBranches(): when.Promise<Branch[]> {
		return this._client.platform().retrieveBranches(this);
	}

	/**
		 * Create a new Online Working Copy for the given project based on a given revision.
		 *
		 * @param revision The team server revision number.
		 * @returns A Promise of a WorkingCopy instance that represents your new Online Working Copy.
		 */
	createWorkingCopy(revision?: Revision): when.Promise<OnlineWorkingCopy> {
		return this._client.platform().createOnlineWorkingCopy(this, revision);
	};

	createFeedbackItem(name: string, description: string, onSuccess?: (feedbackItem: FeedbackItem) => void, onError?: (error) => void): void {
		// TODO
	}

	createUserStory(name: string, description: string, onSuccess: (userStory: UserStory) => void, onError: (error) => void): void {
		// TODO
	}
}

/**
 * An Online Working Copy, which contains a snapshot of your Mendix App model.
 */
export class OnlineWorkingCopy {
	private _client: MendixSdkClient;
	private _id: string;
	private _sourceRevision: Revision;
	private _model: IModel;

	constructor(client: MendixSdkClient, id: string, sourceRevision: Revision, store: IModel) {
		this._client = client;
		this._id = id;
		this._sourceRevision = sourceRevision;
		this._model = store;
	}

	/**
		 * @returns ID of this Online Working Copy
		 */
	id(): string {
		return this._id;
	}

	/**
	* @returns Revision (which contains the team server source branch) of this Online Working Copy
	*/
	sourceRevision(): Revision {
		return this._sourceRevision;
	}

	/**
		 * @returns The project of which this Online Working Copy contains a model snapshot.
		 */
	project(): Project {
		return this._sourceRevision.branch().project();
	}

	/**
		 * @returns The model stored in this Online Working Copy
		 */
	model(): IModel {
		return this._model;
	}

	/**
		 * Commit changes in this Online Working Copy to the Team Server.
		 * IMPORTANT: After committing, the connection to the Model Server is closed.
		 * This means that you cannot commit any changes you make to the working copy after first committing.
		 * If you want to make any further changes, create a new working copy by calling createWorkingCopy()
		 * on the returned revision.
		 *
		 * @param branchName (Optional) the branch to commit to. Use null for main line.
		 * @param baseRevision (Optional) the base revision of this commit.
		 * @returns a Promise of a Team Server Revision
		 */
	commit(branchName?: string, baseRevision?: number): when.Promise<Revision> {
		return when.promise<void>((resolve, reject) => {
			console.log(`Closing connection to Model API...`);
			this._model.closeConnection(
				() => {
					console.log(`Closed connection to Model API successfully.`);
					resolve(null);
				},
				reject);
		}).then(() => {
			return this._client.platform().commitToTeamServer(this, branchName, baseRevision);
		});
	}
}

/**
 * Team Server Revision
 */
export class Revision {
	private _num: number;
	private _branch: Branch;

	// TODO: branch should be optional, in which case mainline is used
	constructor(num: number, branch: Branch) {
		this._num = num;
		this._branch = branch;
	}

	num(): number {
		return this._num;
	}

	branch(): Branch {
		return this._branch;
	}

	createWorkingCopy(): when.Promise<OnlineWorkingCopy> {
		return this._branch.project().createWorkingCopy(this);
	}

	/**
		 * TODO: Implementation
		 */
	deploy(onSuccess: (deploymentInfo: DeploymentInfo) => void, onError: (error) => void): when.Promise<DeploymentInfo> {
		return when.promise<DeploymentInfo>((resolve, reject) => {
			console.log('Deploying %s@%d of %s:%s...', this._branch.name(), this._num, this._branch.project().name(), this._branch.project().id());

			let deploymentInfo: DeploymentInfo = null;

			console.log('Deployment of %s@%d of %s:%s successful.', this._branch.name(), this._num, this._branch.project().name(), this._branch.project().id());
			resolve(deploymentInfo);
		});
	}
}

/**
 * Team Server branch line
 */
export class Branch {
	private _project: Project;
	private _name: string;

	constructor(project: Project, name: string) {
		this._project = project;
		this._name = name;
	}

	project(): Project {
		return this._project;
	}

	name(): string {
		return this._name;
	}

	retrieveRevisions(): when.Promise<Revision[]> {
		return when.promise<Revision[]>((resolve, reject) => {
			console.log(`Retrieving revisions for project ${this._project.name() } branch ${this.name}...`);

			// TODO: Retrieve revisions for this branch with the Platform API
			let revisions: Revision[] = null;

			resolve(revisions);
		});
	}
}

export interface DeploymentInfo {
	applicationUrl(): string;
}

export interface FeedbackItem {

}

export interface UserStory {

}

function rejectWithError(error: Error, reject: (reason: any) => void): void {
	let errorType = typeof (error);
	switch (errorType) {
		case 'ParseError':
			reject(`Response parsing error: ${error.message}. Please consult https://mxforum.mendix.com/`);
			break;
		case 'EmptyError':
			reject(`Empty response error: ${error.message}. Please consult https://mxforum.mendix.com/`);
			break;
		default:
			reject(`${error.name}: ${error.message}. Please consult https://mxforum.mendix.com/`);
			break;
	}
}
