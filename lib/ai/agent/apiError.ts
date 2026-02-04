export class AgentApiError extends Error {
  status: number;
  url: string;
  bodyText: string;
  bodyJson: any;

  constructor(args: { message: string; status: number; url: string; bodyText: string; bodyJson?: any }) {
    super(args.message);
    this.name = 'AgentApiError';
    this.status = args.status;
    this.url = args.url;
    this.bodyText = args.bodyText;
    this.bodyJson = args.bodyJson;
  }
}

export const isAgentApiError = (e: unknown): e is AgentApiError => {
  return Boolean(e && typeof e === 'object' && (e as any).name === 'AgentApiError' && typeof (e as any).status === 'number');
};

export const readErrorBody = async (res: Response): Promise<{ text: string; json: any }> => {
  const text = await res.text().catch(() => '');
  try {
    const json = text ? JSON.parse(text) : null;
    return { text, json };
  } catch {
    return { text, json: null };
  }
};

