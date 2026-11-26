// Call and WhatsApp in one tap - for anyone with a phone number.

import { Icon } from './Icon';
import { telHref, waHref } from '../lib/contact';

export function ContactButtons({ phone, name, compact }: { phone: string; name: string; compact?: boolean }) {
  const tel = telHref(phone);
  const wa = waHref(phone);
  if (!tel) return null;
  return (
    <span className="row gap-4 contact-buttons">
      <a className={compact ? 'icon-btn' : 'btn btn-sm'} href={tel} aria-label={`חיוג ל${name}`} title={phone}>
        <Icon name="phone" size={compact ? 16 : 14} />
        {!compact && 'חיוג'}
      </a>
      <a className={compact ? 'icon-btn' : 'btn btn-sm'} href={wa!} target="_blank" rel="noreferrer noopener" aria-label={`וואטסאפ ל${name}`}>
        <Icon name="message" size={compact ? 16 : 14} />
        {!compact && 'וואטסאפ'}
      </a>
    </span>
  );
}
