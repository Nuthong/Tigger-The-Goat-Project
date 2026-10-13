/**
 * The hotel's identity - one source of truth for the site footer, the printable
 * documents, the booking confirmation page and the calendar (.ics) export.
 *
 * These strings used to be copy-pasted and had drifted: the footer and the
 * invoices said Rajdamri Road while the booking detail and the .ics said
 * Charoen Krung Road. Everything reads from here now.
 */
export const HOTEL = {
  name: "Tigger Oriental",
  city: "Bangkok",
  /** street + district, then city + postcode + country - for a stacked block */
  addressLines: ["Rajdamri Road, Lumphini, Pathum Wan", "Bangkok 10330, Thailand"],
  /** the same address on one line - for the .ics LOCATION and inline copy */
  addressOneLine: "Rajdamri Road, Lumphini, Pathum Wan, Bangkok 10330, Thailand",
  phone: "+66 2 000 0000",
  phoneHref: "tel:+6620000000",
  email: "stay@tiggeroriental.com",
  taxId: "Tax ID 0-1055-00000-00-0",
  checkInFrom: "15:00",
  checkOutBy: "12:00",
} as const;
