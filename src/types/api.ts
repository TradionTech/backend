export type ChatRequest = {
  session_id: string;
  message: string;
  message_type?: 'text';
};

