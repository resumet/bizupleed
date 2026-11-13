import type { Metadata } from "next";
import Script from "next/script";
import { PublicLanding } from "@/components/PublicLanding";
import { getPublicLanding } from "@/lib/landings";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/p/[slug]">): Promise<Metadata> {
  const pub = await getPublicLanding((await params).slug);
  return pub ? { title: pub.content.settings.title, robots: { index: false } } : { title: "페이지를 찾을 수 없습니다" };
}

export default async function Page({ params }: PageProps<"/p/[slug]">) {
  const { slug } = await params;
  const pub = await getPublicLanding(slug);
  if (!pub)
    return (
      <main className="flex min-h-screen items-center justify-center bg-white p-6 text-center">
        <div>
          <p className="text-lg font-bold text-gray-900">현재 공개되지 않은 페이지입니다</p>
          <p className="mt-2 text-sm text-gray-500">주소를 다시 확인하시거나 운영자에게 문의해 주세요.</p>
        </div>
      </main>
    );
  // 픽셀 ID 는 저장 시 형식 검증됨(숫자 / G-XXXX / 영숫자). 스크립트 문자열에는 JSON 인코딩해 삽입한다.
  const { meta, ga4, daangn } = pub.pixels;
  return (
    <main className="min-h-screen bg-gray-200">
      {meta && (
        <Script id="px-meta" strategy="afterInteractive">{`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${JSON.stringify(meta)});fbq('track','PageView');`}</Script>
      )}
      {ga4 && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4)}`} strategy="afterInteractive" />
          <Script id="px-ga4" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(ga4)});`}</Script>
        </>
      )}
      {daangn && (
        <>
          <Script src="https://karrot-pixel.business.daangn.com/0.2/karrot-pixel.js" strategy="afterInteractive" />
          <Script id="px-daangn" strategy="lazyOnload">{`if(window.karrotPixel){window.karrotPixel.init(${JSON.stringify(daangn)});window.karrotPixel.track('ViewPage');}`}</Script>
        </>
      )}
      <PublicLanding slug={slug} content={pub.content} mode={pub.landing.mode} />
    </main>
  );
}
