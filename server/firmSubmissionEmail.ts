import type { ClientIntakeFormData, UploadedDocument } from '../src/types/index.js';

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  cid?: string;
}

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]!));
const answer = (value: unknown) => typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value ?? '').trim() || 'Not provided';
const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value || '')
  ? value.split('-').reverse().join('/') : answer(value);
const money = (value: string) => {
  if (!value?.trim()) return 'Not provided';
  const numeric = Number(value.replace(/[$,\s]/g, ''));
  return Number.isFinite(numeric) ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(numeric) : value;
};

/** Pure renderer: only client answers are included; no cookies, telemetry or storage credentials. */
export function renderFirmSubmissionEmail(input: {
  formData: ClientIntakeFormData;
  matterReference: string;
  submittedAt: string;
  liveSign: 'sent' | 'pending' | 'error';
  detail?: string;
  unattachedFiles?: string[];
}) {
  const { formData: form, matterReference, liveSign, detail } = input;
  const attachments: EmailAttachment[] = [];
  const plain: string[] = [];
  const rows = (values: Array<[string, unknown]>) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed">${values.map(([label, value]) => {
    plain.push(`${label}: ${answer(value)}`);
    return `<tr><td width="40%" valign="top" style="padding:11px 12px 11px 0;border-bottom:1px solid #e5edf3;font-size:13px;color:#56677b;word-wrap:break-word">${escape(label)}</td><td valign="top" style="padding:11px 0;border-bottom:1px solid #e5edf3;font-size:14px;color:#152a43;font-weight:600;word-wrap:break-word;overflow-wrap:anywhere;white-space:pre-wrap">${escape(answer(value))}</td></tr>`;
  }).join('')}</table>`;
  let sectionNumber = 0;
  const section = (title: string, content: () => string) => {
    plain.push(`\n${title.toUpperCase()}`);
    return `<tr><td style="padding:24px 24px 0"><h2 style="margin:0 0 8px;font-size:17px;color:#152a43"><span style="color:#0084aa">${String(++sectionNumber).padStart(2, '0')}.</span> ${escape(title)}</h2>${content()}</td></tr>`;
  };
  const documents = (list: UploadedDocument[]) => list.length
    ? list.map((d, i): [string, unknown] => [`Document ${i + 1}`, `${d.fileName} (${d.mimeType}, ${Math.ceil(d.sizeBytes / 1024)} KB)${d.uploadedAt ? ` — uploaded ${date(d.uploadedAt.slice(0, 10))}` : ''}`])
    : [['Uploaded documents', 'None uploaded']] as Array<[string, unknown]>;
  const primary = form.parties[0];
  const name = primary ? [primary.firstName, primary.middleName, primary.lastName].filter(Boolean).join(' ') : 'Client';
  const property = form.property;
  const propertyAddress = [property.addressLine1, property.suburb, property.state, property.postcode].filter(Boolean).join(', ');
  const submitted = new Date(input.submittedAt);
  const submittedLabel = Number.isNaN(submitted.getTime()) ? answer(input.submittedAt) : `${submitted.toLocaleString('en-AU', { timeZone: 'Australia/Adelaide', dateStyle: 'medium', timeStyle: 'short' })} (Adelaide time)`;
  const status = liveSign === 'sent' ? 'Sent to LiveSign — awaiting identity checks' : liveSign === 'pending' ? 'LiveSign pending — automatic retry scheduled' : 'LiveSign error — staff review required';
  const statusColor = liveSign === 'error' ? '#a32b21' : liveSign === 'pending' ? '#7b5100' : '#07654e';
  const statusBg = liveSign === 'error' ? '#fff1ef' : liveSign === 'pending' ? '#fff8e8' : '#eaf8f1';
  plain.push(`NEW ${form.role.toUpperCase()} FORM`, name, `Reference: ${matterReference}`, `Submitted: ${submittedLabel}`, `LiveSign: ${status}`);
  const summary = rows([
    ['Primary client', name], ['Email', primary?.email], ['Phone', primary ? `${primary.phoneCountryCode || '+61'} ${primary.mobile}` : ''],
    ['Form', `${form.role} client intake`], ['Reference', matterReference], ['Submitted', submittedLabel],
    ['Property', propertyAddress], ['Number of people', form.parties.length],
    ['Client structure', form.isCompanyOrTrust === 'Yes' ? 'Company / Trust' : form.isCompanyOrTrust === 'No' ? 'Individual / Group of Persons' : 'Not provided']
  ]);
  let body = section('Client details', () => form.parties.map((p, i) => {
    plain.push(`\n${form.role} ${i + 1}`);
    return `<h3 style="font-size:15px;color:#0084aa;margin:20px 0 4px">${escape(form.role)} ${i + 1} · ${escape([p.firstName, p.middleName, p.lastName].filter(Boolean).join(' '))}</h3>${rows([
      ['First name', p.firstName], ['Middle name', p.middleName], ['Last name', p.lastName],
      ...(p.isSingleName !== undefined ? [['Single legal name', p.isSingleName] as [string, unknown]] : []),
      ['Date of birth', date(p.dob)], ['Email address', p.email], ['Country dial code', p.phoneCountryCode], ['Phone number', p.mobile],
      ['Residency status', p.residencyStatus], ['Occupation', p.occupation],
      ...(i > 0 ? [['Same address as previous person', p.sameAddressAsPrevious] as [string, unknown]] : []),
      ['Address line 1', p.addressLine1], ['Address line 2', p.addressLine2], ['Suburb / city', p.suburb], ['State', p.state], ['Postcode', p.postcode], ['Country', p.country],
      ...documents(p.idDocuments || [])
    ])}`;
  }).join(''));
  body += section('Property', () => rows([
    ['Address line 1', property.addressLine1], ['Suburb', property.suburb], ['State', property.state], ['Postcode', property.postcode],
    [form.role === 'Vendor' ? 'Sale price (AUD)' : 'Purchase price (AUD)', money(property.purchasePrice)], ['Settlement date', date(property.settlementDate)],
    ...(form.role === 'Purchaser' ? [['Intended use', property.intendedUse], ...(property.ownershipType ? [['Ownership type', property.ownershipType]] : [])] as Array<[string, unknown]> : [])
  ]));
  const finance = form.finance;
  body += section('Finance', () => rows([
    [form.role === 'Vendor' ? 'Mortgage on the property' : 'Taking a mortgage', finance.mortgageRequired],
    [form.role === 'Vendor' ? 'Bank holding the mortgage' : 'Bank / broker company', finance.lenderName],
    ...(form.role === 'Purchaser' ? [
      ['Banker / broker name', finance.brokerOrBankerName], ['Banker / broker phone', finance.brokerPhone], ['Banker / broker email', finance.brokerEmail],
      ...(finance.paysByElectronicTransfer ? [['Payment by electronic transfer', true]] : []),
      ...(finance.paysByCash ? [['Payment by cash', true], ['Cash amount (AUD)', money(finance.cashAmount)]] : []),
      ...(finance.paysByVirtualAssets ? [['Payment by virtual assets', true], ['Virtual asset amount (AUD)', money(finance.virtualAssetsAmount)]] : []),
      ...(finance.paysByOther ? [['Other payment method', finance.otherPaymentDetails]] : []),
      ...(finance.sourceOfFundsDocuments?.length ? documents(finance.sourceOfFundsDocuments) : [])
    ] as Array<[string, unknown]> : [])
  ]));
  if (form.role === 'Purchaser') {
    const stamp = form.stampDuty;
    body += section('Stamp duty & referral', () => rows([
      ['Stamp duty relief eligibility', stamp.reliefEligible],
      ...([
        ['First home buyer', stamp.firstHomeBuyer], ['Property type', stamp.propertyType],
        ['Contract signed on or after 6 July 2024', stamp.contractSignedOnOrAfter6Jul2024],
        ['Contract signed between 15 June 2023 and 5 July 2024', stamp.contractSignedBetween15Jun2023And5Jul2024],
        ['Within the price threshold', stamp.underPriceThreshold], ['Meets eligibility criteria', stamp.meetsEligibilityCriteria], ['Additional notes', stamp.notes]
      ] as Array<[string, unknown]>).filter(([, value]) => value !== '' && value != null),
      ['How did you hear about us?', form.howDidYouHear]
    ]));
  }
  body += section('Declaration & signature', () => {
    const declaration = form.declaration;
    const signature = declaration.signatureDataUrl || '';
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(signature);
    if (match && match[1].length <= 2_000_000) {
      const content = Buffer.from(match[1], 'base64');
      if (content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        attachments.push({ filename: 'client-signature.png', content, contentType: 'image/png', cid: 'client-signature@raikan' });
      }
    }
    return rows([
      ['Authority to act', declaration.authorityToAct],
      ...(form.role === 'Purchaser' ? [['Cooling-off rights acknowledged', declaration.coolingOffAcknowledged] as [string, unknown]] : []),
      ['Signed full name', declaration.signedName], ['Signed date', date(declaration.signedDate)], ['Drawn signature', signature ? 'Provided' : 'Not provided']
    ]) + (attachments.length ? '<div style="margin-top:16px;padding:16px;border:1px solid #e5edf3;background:#fff"><img src="cid:client-signature@raikan" alt="Client signature" width="280" style="display:block;width:100%;max-width:280px;height:auto"></div>' : '');
  });
  const allDocs = [...(form.idDocuments || []), ...form.parties.flatMap(p => p.idDocuments || []), ...(finance.sourceOfFundsDocuments || [])];
  const uniqueDocs = allDocs.filter((d, i) => allDocs.findIndex(other => other.id === d.id) === i);
  body += section('Documents', () => rows(documents(uniqueDocs)) + (input.unattachedFiles?.length
    ? `<p style="font-size:12px;color:#a32b21">Could not attach: ${escape(input.unattachedFiles.join(', '))}. Please retrieve these files from the saved submission.</p>` : ''));
  if (input.unattachedFiles?.length) plain.push(`Could not attach: ${input.unattachedFiles.join(', ')}. Please retrieve these files from the saved submission.`);
  if (detail) plain.push(`LiveSign problem: ${detail}`);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>New client submission</title></head>
<body style="margin:0;padding:16px 8px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#152a43">
<div style="display:none;max-height:0;overflow:hidden">${escape(name)} · ${escape(form.role)} · ${escape(matterReference)} · ${escape(propertyAddress)}</div>
<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;margin:0 auto;background:#fff;border:1px solid #dce6ee;border-radius:12px">
<tr><td style="padding:28px 24px;background:#142b46;color:#fff;border-top:5px solid #00a5cf"><p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:2px;color:#83dff3">RAIKAN CONVEYANCING</p><h1 style="margin:0;font-size:26px;line-height:1.3">New ${escape(form.role.toLowerCase())} form</h1><p style="margin:10px 0 0;font-size:17px;color:#e3edf6">${escape(name)}</p><p style="margin:8px 0 0;font-size:13px;color:#b8cddd">${escape(matterReference)} · ${escape(submittedLabel)}</p></td></tr>
<tr><td style="padding:20px 24px 0"><div style="padding:14px 16px;background:${statusBg};border-left:4px solid ${statusColor};color:${statusColor};font-size:13px;font-weight:700">${escape(status)}</div>${detail ? `<p style="font-size:13px;color:#a32b21">${escape(detail)}</p>` : ''}<h2 style="font-size:17px;margin:24px 0 8px">At a glance</h2>${summary}</td></tr>
${body}<tr><td style="padding:24px;font-size:12px;color:#56677b">Raikan Conveyancing · ${escape(matterReference)}</td></tr></table></body></html>`;
  return { html, text: plain.join('\n'), attachments, clientName: name };
}
