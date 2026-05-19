import pRetry, { AbortError } from "p-retry";

import {
	SDKError,
	APITimeoutError,
	APIConnectionError,
	APIStatusError,
	BadRequestError,
	AuthenticationError,
	PermissionDeniedError,
	NotFoundError,
	RequestTimeoutError,
	ConflictError,
	UnprocessableEntityError,
	RateLimitError,
	InternalServerError,
} from "./errors.js";

export interface ClientOptions {
	apiKey?: string;
	baseURL?: string;
	timeout?: number;
	maxRetries?: number;
}

interface RequestOptions {
	signal?: AbortSignal | undefined;
}

interface GetRequestOptions extends RequestOptions {
	params?: Record<string, string | number | boolean | undefined>;
}

interface PostRequestOptions extends RequestOptions {
	json?: unknown;
}

interface FinalRequestSignal {
	signal: AbortSignal;
	timeoutSignal: AbortSignal;
	cleanup: () => void;
}

const DEFAULT_BASE_URL = "{{DEFAULT_BASE_URL}}";
const DEFAULT_TIMEOUT = 600_000;
const DEFAULT_MAX_RETRIES = 2;

export class BaseClient {
	private readonly _apiKey: string;
	readonly baseURL: string;
	readonly timeout: number;
	readonly maxRetries: number;

	constructor(options: ClientOptions = {}) {
		const apiKey = options.apiKey ?? process.env["{{ENV_VAR_NAME}}"];
		if (!apiKey) {
			throw new SDKError(
				"Missing API key. Pass `apiKey` to the constructor or set the {{ENV_VAR_NAME}} environment variable.",
			);
		}

		this._apiKey = apiKey;
		this.baseURL = options.baseURL ?? DEFAULT_BASE_URL;
		this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
		this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
	}

	toJSON(): Record<string, unknown> {
		return {
			baseURL: this.baseURL,
			timeout: this.timeout,
			maxRetries: this.maxRetries,
		};
	}

	[Symbol.for("nodejs.util.inspect.custom")](): Record<string, unknown> {
		return this.toJSON();
	}

	protected _buildHeaders(): Record<string, string> {
		return {
			"{{AUTH_HEADER}}": this._apiKey,
			"Content-Type": "application/json",
			Accept: "application/json",
			"User-Agent": `{{PACKAGE_NAME}}/1.0.0`,
		};
	}

	private _buildRequestSignal(callerSignal?: AbortSignal): FinalRequestSignal {
		const timeoutSignal = AbortSignal.timeout(this.timeout);
		if (!callerSignal) {
			return {
				signal: timeoutSignal,
				timeoutSignal,
				cleanup: () => {},
			};
		}

		if (typeof AbortSignal.any === "function") {
			return {
				signal: AbortSignal.any([callerSignal, timeoutSignal]),
				timeoutSignal,
				cleanup: () => {},
			};
		}

		const controller = new AbortController();
		const abortFromCaller = () => controller.abort(callerSignal.reason);
		const abortFromTimeout = () => controller.abort(timeoutSignal.reason);

		if (callerSignal.aborted) {
			abortFromCaller();
		} else if (timeoutSignal.aborted) {
			abortFromTimeout();
		} else {
			callerSignal.addEventListener("abort", abortFromCaller, { once: true });
			timeoutSignal.addEventListener("abort", abortFromTimeout, { once: true });
		}

		return {
			signal: controller.signal,
			timeoutSignal,
			cleanup: () => {
				callerSignal.removeEventListener("abort", abortFromCaller);
				timeoutSignal.removeEventListener("abort", abortFromTimeout);
			},
		};
	}

	private async _request(
		method: string,
		path: string,
		body?: unknown,
		options?: RequestOptions,
	): Promise<Response> {
		const url = `${this.baseURL}${path}`;
		const headers = this._buildHeaders();
		const {
			signal: requestSignal,
			timeoutSignal,
			cleanup,
		} = this._buildRequestSignal(options?.signal);
		try {
			return await pRetry(
				async () => {
					try {
						const response = await fetch(url, {
							method,
							headers,
							body: body !== undefined ? JSON.stringify(body) : undefined,
							signal: requestSignal,
						});

						if (response.ok) {
							return response;
						}

						const sdkError = await this._makeStatusError(response);
						const status = response.status;
						if (status !== 408 && status !== 429 && status < 500) {
							throw new AbortError(sdkError);
						}

						throw sdkError;
					} catch (error) {
						if (error instanceof AbortError || error instanceof SDKError) {
							throw error;
						}

						if (options?.signal?.aborted && !timeoutSignal.aborted) {
							const reason =
								options.signal.reason instanceof Error
									? options.signal.reason
									: new DOMException("Request aborted", "AbortError");
							throw new AbortError(reason);
						}

						if (
							timeoutSignal.aborted ||
							(error instanceof DOMException && error.name === "TimeoutError")
						) {
							throw new AbortError(
								new APITimeoutError(`Request timed out after ${this.timeout}ms`),
							);
						}

						throw new APIConnectionError(
							error instanceof Error ? error.message : "Connection failed",
						);
					}
				},
				{
					retries: this.maxRetries,
					minTimeout: 500,
					maxTimeout: 8_000,
					factor: 2,
				},
			);
		} finally {
			cleanup();
		}
	}

	private async _parseErrorMessage(response: Response): Promise<string> {
		try {
			const text = await response.text();
			try {
				const body = JSON.parse(text) as Record<string, unknown> | null | undefined;
				const errorObj = body?.["error"] as Record<string, unknown> | null | undefined;
				const msg = (errorObj?.["message"] as string) ?? (body?.["message"] as string);
				if (typeof msg === "string" && msg.length > 0) {
					return msg;
				}
			} catch {
				// Not JSON
			}
			if (text.length > 0) {
				return text;
			}
		} catch {
			// Body read failed
		}

		return `HTTP ${response.status}`;
	}

	private async _makeStatusError(response: Response): Promise<SDKError> {
		const msg = await this._parseErrorMessage(response);
		const opts = { response };

		switch (response.status) {
			case 400:
				return new BadRequestError(msg, opts);
			case 401:
				return new AuthenticationError(msg, opts);
			case 403:
				return new PermissionDeniedError(msg, opts);
			case 404:
				return new NotFoundError(msg, opts);
			case 408:
				return new RequestTimeoutError(msg, opts);
			case 409:
				return new ConflictError(msg, opts);
			case 422:
				return new UnprocessableEntityError(msg, opts);
			case 429:
				return new RateLimitError(msg, opts);
			default:
				if (response.status >= 500) {
					return new InternalServerError(msg, {
						response,
						statusCode: response.status,
					});
				}
				return new APIStatusError(msg, {
					response,
					statusCode: response.status,
				});
		}
	}

	async get<T = unknown>(path: string, options?: GetRequestOptions): Promise<T> {
		let url = path;
		if (options?.params) {
			const filtered: Record<string, string> = {};
			for (const [key, value] of Object.entries(options.params)) {
				if (value !== undefined) {
					filtered[key] = String(value);
				}
			}
			const searchParams = new URLSearchParams(filtered);
			url = `${path}?${searchParams.toString()}`;
		}
		const response = await this._request("GET", url, undefined, options);
		return (await response.json()) as T;
	}

	async delete<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
		const response = await this._request("DELETE", path, undefined, options);
		return (await response.json()) as T;
	}

	async post<T = unknown>(path: string, options?: PostRequestOptions): Promise<T> {
		const response = await this._request("POST", path, options?.json, options);
		return (await response.json()) as T;
	}

	async put<T = unknown>(path: string, options?: PostRequestOptions): Promise<T> {
		const response = await this._request("PUT", path, options?.json, options);
		return (await response.json()) as T;
	}

	async patch<T = unknown>(path: string, options?: PostRequestOptions): Promise<T> {
		const response = await this._request("PATCH", path, options?.json, options);
		return (await response.json()) as T;
	}

	async postStream(path: string, options?: PostRequestOptions): Promise<ReadableStream<string>> {
		const response = await this._request("POST", path, options?.json, options);

		if (!response.body) {
			throw new SDKError("Response body is null — server did not return a stream");
		}

		return response.body.pipeThrough(new TextDecoderStream());
	}
}
