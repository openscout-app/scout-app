export type ChatContentLink = {
  label: string;
  url: string;
};

export type ChatContentBlock =
  | { type: "header"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "section"; text?: string; fields?: string[]; link?: ChatContentLink }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; text: string }
  | { type: "quote"; text: string }
  | { type: "divider" }
  | { type: "context"; text: string }
  | { type: "image"; url: string; alt: string }
  | { type: "actions"; links: ChatContentLink[] }
  | {
      type: "task";
      taskId?: string;
      title: string;
      status: string;
      details?: ChatContentBlock[];
      output?: ChatContentBlock[];
      sources?: ChatContentLink[];
    }
  | {
      type: "attachment";
      pretext?: string;
      author?: string;
      title?: string;
      titleUrl?: string;
      text?: string;
      fields?: Array<{ title: string; value: string; short?: boolean }>;
      footer?: string;
      color?: string;
    };
