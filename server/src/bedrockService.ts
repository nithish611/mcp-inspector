import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const DEFAULT_MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';
const DEFAULT_REGION = 'us-east-1';

let client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (!client) {
    client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || DEFAULT_REGION,
    });
  }
  return client;
}

export interface GeneratePayloadRequest {
  toolName: string;
  toolDescription?: string;
  inputSchema: Record<string, unknown>;
  referenceData?: Record<string, unknown>;
}

function buildPrompt(request: GeneratePayloadRequest): string {
  const { toolName, toolDescription, inputSchema, referenceData } = request;

  let prompt = `You are a test data generator. Generate a single realistic JSON object that conforms to the following JSON Schema. The data should look like real-world data, not placeholder values.

Tool name: ${toolName}`;

  if (toolDescription) {
    prompt += `\nTool description: ${toolDescription}`;
  }

  prompt += `

JSON Schema:
${JSON.stringify(inputSchema, null, 2)}`;

  if (referenceData && Object.keys(referenceData).length > 0) {
    const refStr = JSON.stringify(referenceData, null, 2);
    const truncated = refStr.length > 8000 ? refStr.slice(0, 8000) + '\n... (truncated)' : refStr;
    prompt += `

Reference data from previous tool executions on this server. Extract real IDs, names, emails, dates, and other values from this data to use in the generated payload — this makes the payload immediately executable:
${truncated}`;
  }

  prompt += `

Rules:
1. Return ONLY a valid JSON object. No markdown, no explanation, no code fences.
2. Include all required fields.
3. PREFER values extracted from the reference data above (real IDs, associateOIDs, emails, names, etc.) over invented values.
4. For fields that don't match any reference data, generate contextually appropriate realistic values.
5. For number fields, use reasonable ranges.
6. For arrays, include 1-2 example items.
7. For date strings, use ISO 8601 format with recent dates.
8. Respect any enum constraints exactly.`;

  return prompt;
}

function extractJson(text: string): Record<string, unknown> {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to extraction attempts
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // Fall through
    }
  }

  const braceMatch = trimmed.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch {
      // Fall through
    }
  }

  throw new Error('Could not extract valid JSON from model response');
}

export async function generatePayload(request: GeneratePayloadRequest): Promise<Record<string, unknown>> {
  const bedrockClient = getClient();
  const modelId = process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID;
  const prompt = buildPrompt(request);

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 4096,
    temperature: 0.7,
    messages: [
      { role: 'user', content: prompt },
    ],
  });

  try {
    const command = new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(body),
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const text: string = responseBody.content?.[0]?.text || '';

    if (!text) {
      throw new Error('Empty response from Bedrock');
    }

    return extractJson(text);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'CredentialsProviderError') {
      throw new Error('AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables, or configure the AWS credential chain.');
    }
    throw error;
  }
}
