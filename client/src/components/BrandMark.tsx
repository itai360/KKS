// The course's mark, drawn: the קק״ס of the opening screen (client/index.html) - קק״ in white and the ס in the
// course's cyan - rather than the letters typed in a font, whose own spacing (the gershayim, the line's height)
// pushed them off the middle of their square. Another course's symbol (set in the settings) is its letters.

/** the word's shapes, as the opening screen draws them (a test keeps the two the same) */
export const KKS_WORD = {
  viewBox: '51 189 5223 2050',
  k: 'M1825 824H1645L1782 189H2057ZM2272 824H2092L2229 189H2503ZM3152 1092V2239H2882V1092ZM2831 613H3449Q3703 613 3819 709.5Q3935 806 3935 1025Q3935 1310 3763 1536.5Q3591 1763 3269 1895V1608Q3457 1520 3559.5 1373.5Q3662 1227 3662 1057Q3662 945 3606 900Q3550 855 3410 855H2831ZM4491 1092V2239H4221V1092ZM4170 613H4788Q5042 613 5158 709.5Q5274 806 5274 1025Q5274 1310 5102 1536.5Q4930 1763 4608 1895V1608Q4796 1520 4898.5 1373.5Q5001 1227 5001 1057Q5001 945 4945 900Q4889 855 4749 855H4170Z',
  s: 'M133 1227Q133 1128 162.5 1020.5Q192 913 240 855H51V613H745Q1046 613 1181.5 740Q1317 867 1317 1149V1229Q1317 1548 1163 1711Q1009 1874 709 1874Q415 1874 274 1720.5Q133 1567 133 1258ZM475 855Q414 961 414 1211V1256Q414 1633 715 1633Q883 1633 958.5 1536Q1034 1439 1034 1221V1147Q1034 991 961.5 923Q889 855 725 855Z',
};

/** קק"ס however it was typed: with gershayim, a straight quote, or none */
export const isKksSymbol = (symbol: string) => symbol.replace(/[״"”'׳\s]/g, '') === 'קקס';

export function BrandMark({ symbol, className }: { symbol: string; className: string }) {
  if (!isKksSymbol(symbol)) return <span className={className}>{symbol.slice(0, 4)}</span>;
  return (
    <span className={`${className} is-word`}>
      <svg className="brand-word" viewBox={KKS_WORD.viewBox} role="img" aria-label={symbol}>
        <path className="brand-word-k" d={KKS_WORD.k} />
        <path className="brand-word-s" d={KKS_WORD.s} />
      </svg>
    </span>
  );
}
