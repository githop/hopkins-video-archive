import type {
  InferUITools,
  UIMessage,
  ToolUIPart,
  UIMessagePart,
  UIDataTypes,
} from 'ai';
import type { createSearchArchiveTool } from './search-archive.ts';

export { createSearchArchiveTool } from './search-archive.ts';
export type { SearchProvider } from './search-archive.ts';

type SearchArchiveToolReturn = ReturnType<typeof createSearchArchiveTool>;

export type Tools = {
  searchArchive: SearchArchiveToolReturn;
};

export type ArchivistTools = InferUITools<Tools>;
export type ArchivistUiMessage = UIMessage<unknown, any, ArchivistTools>;
export type ArchivistToolPart = ToolUIPart<ArchivistTools>;

export function isArchivistToolPart(
  part: UIMessagePart<UIDataTypes, ArchivistTools>,
): part is ArchivistToolPart {
  return part.type === 'tool-searchArchive';
}
