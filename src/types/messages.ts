import type { QuickAddType } from './models';

export type RuntimeMessage =
  | {
      type: 'OPEN_QUICK_ADD';
      payload?: {
        addType?: QuickAddType;
        content?: string;
        title?: string;
        memo?: string;
      };
    }
  | {
      type: 'OPEN_MANAGER';
    }
  | {
      type: 'DOWNLOAD_MARKDOWN';
      payload: {
        filename: string;
        content: string;
      };
    }
  | {
      type: 'DOWNLOAD_DATA_URL';
      payload: {
        filename: string;
        dataUrl: string;
      };
    };

export interface RuntimeResponse {
  ok: boolean;
  error?: string;
  downloadId?: number;
}
