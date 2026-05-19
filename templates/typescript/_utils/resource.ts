import type { BaseClient } from "./client.js";

export class APIResource {
	protected _client: BaseClient;

	constructor(client: BaseClient) {
		this._client = client;
	}
}
