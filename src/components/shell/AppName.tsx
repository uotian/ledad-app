import localFont from 'next/font/local';

const outfit = localFont({
  src: './fonts/Outfit-Semibold.woff2',
  weight: '600',
  style: 'normal',
  display: 'swap',
});

export default function AppName() {
  return (
    <span className={`${outfit.className} app-name`}>
      <span className="sr-only">ledad</span>
      <span aria-hidden="true">
        l<span className="app-name-letter-e">e</span>d<span className="app-name-letter-a">a</span>d
      </span>
    </span>
  );
}
