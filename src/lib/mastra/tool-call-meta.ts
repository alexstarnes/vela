/**
 * Normalize tool-call objects from Mastra / AI SDK.
 * Provider and SDK versions can surface tool calls in a few different shapes.
 */
export function extractToolCallMeta(tc: unknown): {
  toolName: string;
  toolInput: unknown;
  toolCallId: string | null;
} {
  if (!tc || typeof tc !== 'object') {
    return { toolName: 'unknown', toolInput: {}, toolCallId: null };
  }

  const record = tc as Record<string, unknown>;

  if (record.payload && typeof record.payload === 'object') {
    const payload = record.payload as Record<string, unknown>;
    if (
      record.type === 'tool-call' ||
      typeof payload.toolName === 'string' ||
      typeof payload.toolCallId === 'string' ||
      payload.args !== undefined ||
      payload.input !== undefined
    ) {
      return extractToolCallMeta(record.payload);
    }
  }

  if (
    record.toolInvocation &&
    typeof record.toolInvocation === 'object' &&
    !record.toolName &&
    !record.name &&
    !record.function
  ) {
    return extractToolCallMeta(record.toolInvocation);
  }

  const toolCallId =
    (typeof record.toolCallId === 'string' && record.toolCallId) ||
    (typeof record.id === 'string' && record.id) ||
    null;

  let toolName =
    (typeof record.toolName === 'string' && record.toolName) ||
    (typeof record.name === 'string' && record.name) ||
    (typeof record.tool === 'string' && record.tool) ||
    '';

  let toolInput: unknown =
    record.input ?? record.args ?? record.arguments ?? record.parameters;

  const fn = record.function;
  if (fn && typeof fn === 'object') {
    const functionRecord = fn as Record<string, unknown>;
    if (!toolName && typeof functionRecord.name === 'string') {
      toolName = functionRecord.name;
    }
    if (toolInput === undefined || toolInput === null) {
      if (functionRecord.arguments !== undefined) {
        toolInput = functionRecord.arguments;
      }
    }
  }

  if (!toolName) {
    toolName = 'unknown';
  }

  if (toolInput === undefined || toolInput === null) {
    toolInput = {};
  }

  if (typeof toolInput === 'string') {
    try {
      toolInput = JSON.parse(toolInput) as unknown;
    } catch {
      toolInput = { _raw: toolInput };
    }
  }

  return { toolName, toolInput, toolCallId };
}
