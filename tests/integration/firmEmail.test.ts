import { validPurchaserForm } from '../helpers/setup.js';
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { app } from '../../server/app.js';
import { firmEmails } from '../../server/emailService.js';
import type { AddressInfo } from 'node:net';
import { unlink } from 'node:fs/promises';
import { readUploadedFile } from '../../server/supabaseClient.js';

test('submission sends full form to all three firm recipients, without disclosing it in client emails', async () => {
  const messages: any[] = [];
  const recipients = ['admin1@example.com', 'admin2@example.com', 'admin3@example.com'];
  const originalRecipients = [...firmEmails];
  const originalUser = process.env.SMTP_USER;
  const originalPass = process.env.SMTP_PASS;
  // All SMTP goes to this stub; no real messages or credentials are used.
  const transport = mock.method(nodemailer, 'createTransport', (() => ({
    sendMail: async (message: any) => { messages.push(message); return { messageId: 'fake-message' }; }
  })) as any);
  firmEmails.splice(0, firmEmails.length, ...recipients);
  process.env.SMTP_USER = 'fake@example.com';
  process.env.SMTP_PASS = 'fake';
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  let uploadedPath: string | undefined;
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const upload = await fetch(`${base}/api/uploads?kind=identity`, {
      method: 'POST', headers: { 'Content-Type': 'image/png', 'X-File-Name': 'identity-front.png' }, body: png
    });
    assert.equal(upload.status, 200);
    const { document } = await upload.json();
    uploadedPath = document.storagePath;
    const form = validPurchaserForm();
    form.parties[0].middleName = 'IntegrationMiddleName';
    // The UI includes uploads both per person and in the flattened register.
    form.parties[0].idDocuments = [document];
    form.idDocuments = [document];
    const response = await fetch(`${base}/api/intake`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ formData: form })
    });
    assert.equal(response.status, 200);
    const firmMessages = messages.filter(message => recipients.includes(message.to));
    assert.deepEqual(firmMessages.map(message => message.to), recipients);
    for (const message of firmMessages) {
      assert.match(message.html, /IntegrationMiddleName/);
      assert.match(message.text, /Signed full name: Dhruvil Tester/);
      assert.match(message.text, /Date of birth: 12\/03\/1985/);
      assert.match(message.html, /At a glance/);
      assert.match(message.subject, /IntegrationMiddleName/);
      const documents = message.attachments.filter((attachment: any) => attachment.filename === 'identity-front.png');
      assert.equal(documents.length, 1, 'each uploaded file attached once per admin');
      assert.deepEqual(documents[0].content, png);
      assert.doesNotMatch(message.html, /Uploaded files remain|Blank optional answers|confidential client information/);
    }
    for (const message of messages.filter(message => !recipients.includes(message.to))) {
      assert.doesNotMatch(message.html, /Date of birth|IntegrationMiddleName|Authority to act/);
      assert.ok(!message.attachments?.length, 'uploaded documents only go to firm recipients');
    }
  } finally {
    transport.mock.restore();
    firmEmails.splice(0, firmEmails.length, ...originalRecipients);
    if (originalUser === undefined) delete process.env.SMTP_USER; else process.env.SMTP_USER = originalUser;
    if (originalPass === undefined) delete process.env.SMTP_PASS; else process.env.SMTP_PASS = originalPass;
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (uploadedPath?.startsWith('local:')) {
      await unlink(new URL(`../../server/uploads/${uploadedPath.slice(6)}`, import.meta.url));
    }
  }
});

test('attachment reader rejects arbitrary disk paths, URLs and unexpected buckets', async () => {
  for (const storagePath of ['local:../../.env', 'https://example.com/document.pdf', 'local:C:/secrets.pdf',
    'supabase:other-bucket/2026/11/12345678-1234-1234-1234-123456789012.pdf']) {
    await assert.rejects(readUploadedFile(storagePath));
  }
});
