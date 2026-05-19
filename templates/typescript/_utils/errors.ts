export class SDKError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SDKError";
	}
}

export class SSEParseError extends SDKError {
	readonly line: string;

	constructor(message: string, line: string) {
		super(message);
		this.name = "SSEParseError";
		this.line = line;
	}
}

export class APIError extends SDKError {
	readonly request: Request | undefined;
	readonly response: Response | undefined;

	constructor(
		message: string,
		options?: { request?: Request | undefined; response?: Response | undefined },
	) {
		super(message);
		this.name = "APIError";
		this.request = options?.request;
		this.response = options?.response;
	}
}

export class APIConnectionError extends APIError {
	constructor(message: string, options?: { request?: Request | undefined }) {
		super(message, options);
		this.name = "APIConnectionError";
	}
}

export class APITimeoutError extends APIConnectionError {
	constructor(message: string, options?: { request?: Request | undefined }) {
		super(message, options);
		this.name = "APITimeoutError";
	}
}

export class APIStatusError extends APIError {
	readonly statusCode: number;

	constructor(
		message: string,
		options: { response: Response; statusCode: number; request?: Request | undefined },
	) {
		super(message, { request: options.request, response: options.response });
		this.name = "APIStatusError";
		this.statusCode = options.statusCode;
	}
}

export class BadRequestError extends APIStatusError {
	constructor(message: string, options: { response: Response; request?: Request | undefined }) {
		super(message, { ...options, statusCode: 400 });
		this.name = "BadRequestError";
	}
}

export class AuthenticationError extends APIStatusError {
	constructor(message: string, options: { response: Response; request?: Request | undefined }) {
		super(message, { ...options, statusCode: 401 });
		this.name = "AuthenticationError";
	}
}

export class PermissionDeniedError extends APIStatusError {
	constructor(message: string, options: { response: Response; request?: Request | undefined }) {
		super(message, { ...options, statusCode: 403 });
		this.name = "PermissionDeniedError";
	}
}

export class NotFoundError extends APIStatusError {
	constructor(message: string, options: { response: Response; request?: Request | undefined }) {
		super(message, { ...options, statusCode: 404 });
		this.name = "NotFoundError";
	}
}

export class RequestTimeoutError extends APIStatusError {
	constructor(message: string, options: { response: Response; request?: Request | undefined }) {
		super(message, { ...options, statusCode: 408 });
		this.name = "RequestTimeoutError";
	}
}

export class ConflictError extends APIStatusError {
	constructor(message: string, options: { response: Response; request?: Request | undefined }) {
		super(message, { ...options, statusCode: 409 });
		this.name = "ConflictError";
	}
}

export class UnprocessableEntityError extends APIStatusError {
	constructor(message: string, options: { response: Response; request?: Request | undefined }) {
		super(message, { ...options, statusCode: 422 });
		this.name = "UnprocessableEntityError";
	}
}

export class RateLimitError extends APIStatusError {
	constructor(message: string, options: { response: Response; request?: Request | undefined }) {
		super(message, { ...options, statusCode: 429 });
		this.name = "RateLimitError";
	}
}

export class InternalServerError extends APIStatusError {
	constructor(
		message: string,
		options: {
			response: Response;
			statusCode?: number | undefined;
			request?: Request | undefined;
		},
	) {
		super(message, {
			response: options.response,
			statusCode: options.statusCode ?? 500,
			request: options.request,
		});
		this.name = "InternalServerError";
	}
}
