import type { MergeMode, MergeResult, SourceItem } from '../types/models';

function makeSummary(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= 220) return compact || '（概要未生成）';
  return `${compact.slice(0, 220)}...`;
}

function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

function dedupeParagraphs(texts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of texts) {
    const normalized = normalizeLineBreaks(raw);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out.join('\n\n');
}

function fillTemplate(template: string, data: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(data)) {
    output = output.replaceAll(`{{${key}}}`, value);
  }
  return output;
}

export function mergeSources(
  sources: SourceItem[],
  mode: MergeMode,
  template: string,
  title: string,
  notes: string
): MergeResult {
  const sourceList = sources.map((source) => `- ${source.title}`).join('\n');

  if (mode === 'simple') {
    const combined = sources
      .map((source, i) => `### ${i + 1}. ${source.title}\n${normalizeLineBreaks(source.body) || '（本文抽出不可）'}`)
      .join('\n\n');

    return {
      title,
      markdown: `# ${title}\n\n## 元ソース一覧\n${sourceList}\n\n## 連結本文\n${combined}\n\n## 補足メモ\n${notes || '（なし）'}\n`
    };
  }

  const body = dedupeParagraphs(
    sources.map((source, i) => `### ${i + 1}. ${source.title}\n${normalizeLineBreaks(source.body) || '（本文抽出不可）'}`)
  );

  const summarySeed = dedupeParagraphs(sources.map((source) => source.body));
  const summary = makeSummary(summarySeed);

  const markdown = fillTemplate(template, {
    title,
    summary,
    sourceList,
    body,
    notes: notes || '（なし）'
  });

  return { title, markdown };
}
