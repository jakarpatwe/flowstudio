// Builds a Thai PromptPay QR payload (EMVCo merchant-presented, tag 29) with a fixed amount.
// target: mobile number (0812345678) or 13-digit tax/citizen id.

function tlv(id: string, value: string) {
  return id + value.length.toString().padStart(2, '0') + value;
}

function crc16(payload: string) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function promptPayPayload(target: string, amount: number): string {
  const digits = target.replace(/\D/g, '');
  const account = digits.length >= 13
    ? tlv('02', digits)
    : tlv('01', ('0000000000000' + digits.replace(/^0/, '66')).slice(-13));
  const merchant = tlv('29', tlv('00', 'A000000677010111') + account);
  const body = tlv('00', '01') + tlv('01', '12') + merchant + tlv('58', 'TH') + tlv('53', '764') +
    tlv('54', amount.toFixed(2)) + '6304';
  return body + crc16(body);
}
