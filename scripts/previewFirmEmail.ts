// Generates a local design preview using fictional answers. No SMTP, database or LiveSign calls.
import { mkdir, writeFile } from 'node:fs/promises';
import { createInitialFormData, createParty } from '../src/components/form/formState.js';
import { renderFirmSubmissionEmail } from '../server/firmSubmissionEmail.js';

const form = createInitialFormData();
form.roleConfirmed = true;
form.partyCount = 2;
form.parties = ['Alex', 'Jordan'].map((name, i) => ({
  ...createParty(`preview-${i}`), firstName: name, lastName: 'Morgan', dob: '1985-03-12',
  email: `${name.toLowerCase()}@example.com`, mobile: '0412 345 678',
  residencyStatus: 'Australian Citizen', occupation: i === 0 ? 'Engineer' : 'Teacher',
  addressLine1: '24 Example Street', suburb: 'Adelaide', state: 'SA', postcode: '5000',
  sameAddressAsPrevious: i > 0
}));
form.property = {
  addressLine1: '12 Example Avenue', suburb: 'Adelaide', state: 'SA', postcode: '5000',
  purchasePrice: '650000', settlementDate: '2026-12-18', intendedUse: 'To live in', ownershipType: 'Joint Tenants'
};
Object.assign(form.finance, {
  mortgageRequired: 'Yes', brokerOrBankerName: 'Taylor Smith', brokerPhone: '0412 000 000',
  brokerEmail: 'taylor@example.com', lenderName: 'Example Finance'
});
form.stampDuty.reliefEligible = 'No';
form.howDidYouHear = 'Recommendation from a friend';
Object.assign(form.declaration, {
  authorityToAct: true, coolingOffAcknowledged: true, signedName: 'Alex Morgan', signedDate: '2026-11-19'
});
const result = renderFirmSubmissionEmail({
  formData: form, matterReference: 'RK-2026-0123', submittedAt: '2026-11-19T02:30:00Z', liveSign: 'sent'
});
await mkdir('docs', { recursive: true });
await writeFile('docs/firm-submission-email-preview.html', result.html);
console.log('Preview saved: docs/firm-submission-email-preview.html (fictional data only)');
