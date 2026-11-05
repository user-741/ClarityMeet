// Minimal types for the parts of nodemailer we use (avoids pulling in @types/nodemailer).
declare module "nodemailer" {
  interface SendMailOptions {
    from?: string; to?: string; replyTo?: string;
    subject?: string; text?: string; html?: string;
  }
  interface Transporter {
    sendMail(opts: SendMailOptions): Promise<{ messageId?: string }>;
  }
  interface TransportOptions {
    host?: string; port?: number; secure?: boolean; service?: string;
    auth?: { user: string; pass: string };
    jsonTransport?: boolean;
  }
  function createTransport(opts: TransportOptions): Transporter;
  const nodemailer: { createTransport: typeof createTransport };
  export default nodemailer;
  export { createTransport, Transporter, SendMailOptions };
}
