import type { Metadata } from "next";
import { site } from "@/content/site";
import { PageHead } from "@/components/PageHead";
import { Band } from "@/components/primitives";
import { LegalBody } from "@/components/LegalBody";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms that apply to using the Corelith Technologies website.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <>
      <PageHead
        index="—"
        datum="Terms"
        title="Terms of use."
        lead="These cover this website. Engagements and products are governed by their own signed agreements, not by this page."
        measure={`Last updated ${site.legal.updated}`}
      />

      <Band tone="ground">
        <LegalBody
          sections={[
            {
              heading: "What this covers",
              body: [
                `These terms apply to this website at ${site.domain}. They do not govern a client engagement with ${site.legal.entity}, which is covered by the agreement signed for that work, and they do not govern the use of Paralith, which is covered by the licence supplied with it. Where a signed agreement and this page differ, the signed agreement applies.`,
              ],
            },
            {
              heading: "The content here",
              body: [
                "The text, design, code, drawings and marks on this site belong to Corelith Technologies. You are welcome to read, link to, quote with attribution, and share it. Reproducing substantial parts of it as your own, or using the Corelith name or marks in a way that suggests an association that does not exist, is not permitted.",
                "Descriptions of capabilities and products describe what exists at the time of writing. They are not an offer, a warranty, or a commitment to a specific outcome.",
              ],
            },
            {
              heading: "Accuracy",
              body: [
                "We work hard to keep this site factual — versions, platforms and capabilities are taken from the systems themselves rather than from marketing copy. It can still go out of date between a release and an edit. Nothing here should be relied on as a substitute for a written answer to your actual question.",
              ],
            },
            {
              heading: "What you send us",
              body: [
                "Submitting the project form or emailing us does not create a contract and does not by itself create an obligation of confidence. Please do not send confidential material, credentials, or anything under an NDA in a first message — tell us it exists and we will agree how to handle it properly first.",
                "By sending a message you confirm the details you provide are accurate and that you are entitled to share them.",
              ],
            },
            {
              heading: "Availability",
              body: [
                "This site is provided as it is. We do not guarantee it will be uninterrupted or error free, and we are not liable for loss arising from its unavailability or from reliance on its content. Nothing here excludes liability that cannot lawfully be excluded.",
              ],
            },
            {
              heading: "External links",
              body: [
                "Where this site links out, the destination is not under our control and we are not responsible for its content or its privacy practices.",
              ],
            },
            {
              heading: "Questions",
              body: [
                `Anything unclear here, write to ${site.email.general}. If a term needs to be different for your situation, that is what the engagement agreement is for.`,
              ],
            },
          ]}
        />
      </Band>
    </>
  );
}
