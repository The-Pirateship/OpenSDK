import { SSEParseError } from "./errors.js";

const DATA_PREFIX = "data:";

async function* splitLines(stream: ReadableStream<string>): AsyncGenerator<string> {
	const reader = stream.getReader();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += value;
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				yield line;
			}
		}

		if (buffer.length > 0) {
			yield buffer;
		}
	} finally {
		reader.releaseLock();
	}
}

export async function* parseSSEStream(
	stream: ReadableStream<string>,
): AsyncGenerator<Record<string, unknown>> {
	for await (const rawLine of splitLines(stream)) {
		const line = rawLine.trim();

		if (!line || line.startsWith(":")) {
			continue;
		}

		if (line.startsWith(DATA_PREFIX)) {
			const dataStr = line.slice(DATA_PREFIX.length).trim();

			try {
				yield JSON.parse(dataStr) as Record<string, unknown>;
			} catch {
				throw new SSEParseError("Malformed JSON in SSE event", line);
			}
		}
	}
}
