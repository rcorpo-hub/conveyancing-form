import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validPurchaserForm } from '../helpers/setup.js';
import { renderFirmSubmissionEmail } from '../../server/firmSubmissionEmail.js';
import type { ClientIntakeFormData } from '../../src/types/index.js';

function render(formData = validPurchaserForm(), liveSign: 'sent' | 'pending' | 'error' = 'sent') {
  return renderFirmSubmissionEmail({ formData: formData as ClientIntakeFormData, matterReference: 'RK-2026-0123', submittedAt: '2026-11-19T02:30:00Z', liveSign });
}

test('firm email contains every person, full property/finance/stamp duty details and declaration', () => {
  const form = validPurchaserForm();
  form.parties[0].middleName = 'Alex';
  form.parties[0].addressLine2 = 'Unit 12';
  form.finance.brokerOrBankerName = 'Morgan Broker';
  form.finance.brokerPhone = '0412 999 888';
  form.finance.brokerEmail = 'broker@example.com';
  form.stampDuty.firstHomeBuyer = 'No';
  form.stampDuty.notes = 'Please call before settlement.';
  const message = render(form);
  for (const value of ['Dhruvil', 'Vatsal', 'Alex', 'Unit 12', '12 King William Street', '$650,000.00',
    'Joint Tenants', 'Morgan Broker', '0412 999 888', 'broker@example.com', 'BankSA', 'Google search',
    'Please call before settlement.', 'Dhruvil Tester', 'Authority to act: Yes', 'Cooling-off rights acknowledged: Yes',
    'First home buyer: No', '19 Nov 2026', 'RK-2026-0123']) {
    assert.ok(message.text.includes(value), `missing answer: ${value}`);
  }
  assert.match(message.html, /At a glance/);
  assert.match(message.html, /Declaration &amp; signature/);
  assert.doesNotMatch(message.html, /\[object Object\]|undefined/);
});

test('HTML escapes submitted answers and never exposes private storage paths', () => {
  const form = validPurchaserForm();
  form.parties[0].firstName = '<script>alert("x")</script>';
  form.idDocuments = [{ id: 'doc1', kind: 'identity', fileName: '<passport>.pdf', mimeType: 'application/pdf',
    sizeBytes: 2048, storagePath: 'private-bucket/secret-path', uploadedAt: '2026-11-19T01:00:00Z' }];
  const message = render(form);
  assert.ok(message.html.includes('&lt;script&gt;'));
  assert.ok(message.html.includes('&lt;passport&gt;.pdf'));
  assert.doesNotMatch(message.html, /<script>|private-bucket|secret-path/);
});

test('drawn PNG signature is an inline attachment; missing signature is explicit', () => {
  const form = validPurchaserForm();
  form.declaration.signatureDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const message = render(form);
  assert.equal(message.attachments.length, 1);
  assert.match(message.html, /src="cid:client-signature@raikan"/);
  assert.ok(message.attachments[0].content.length > 8);
  form.declaration.signatureDataUrl = '';
  const unsigned = render(form);
  assert.equal(unsigned.attachments.length, 0);
  assert.match(unsigned.text, /Drawn signature: Not provided/);
});

test('vendor submission shows vendor answers and excludes purchaser-only questions', () => {
  const form = validPurchaserForm();
  form.role = 'Vendor';
  const message = render(form, 'pending');
  assert.match(message.text, /Sale price \(AUD\)/);
  assert.match(message.text, /Bank holding the mortgage: BankSA/);
  assert.match(message.text, /LiveSign pending/);
  assert.doesNotMatch(message.text, /Stamp duty|Cooling-off|First home buyer|Banker \/ broker/);
});

test('negative answers are preserved and optional blanks do not turn into missing values', () => {
  const form = validPurchaserForm();
  form.finance.mortgageRequired = 'No';
  form.declaration.authorityToAct = false;
  const message = render(form, 'error');
  assert.match(message.text, /Taking a mortgage: No/);
  assert.match(message.text, /Authority to act: No/);
  assert.match(message.text, /Middle name: Not provided/);
  assert.match(message.html, /LiveSign error/);
});

test('missing attachment has a short notice while the normal footer stays simple', () => {
  const message = renderFirmSubmissionEmail({ formData: validPurchaserForm() as ClientIntakeFormData,
    matterReference: 'RK-2026-0123', submittedAt: '2026-11-19T02:30:00Z', liveSign: 'sent', unattachedFiles: ['missing.pdf'] });
  assert.match(message.text, /Could not attach: missing.pdf/);
  assert.match(message.html, /Raikan Conveyancing · RK-2026-0123/);
  assert.doesNotMatch(message.html, /Blank optional answers|Uploaded files remain|confidential client information/);
});
