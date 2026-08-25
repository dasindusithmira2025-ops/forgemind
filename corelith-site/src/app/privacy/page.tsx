import type { Metadata } from "next";
import { site } from "@/content/site";
import { PageHead } from "@/components/PageHead";
import { Band } from "@/components/primitives";
import { LegalBody } from "@/components/LegalBody";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What this website collects, which is almost nothing, and what Corelith Technologies does with the one thing it does collect.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <>
      <PageHead
        index="—"
        datum="Privacy"
        title="What this site collects."
        lead="Almost nothing. This page describes the whole of it rather than describing a policy."
        measure={`Last updated ${site.legal.updated}`}
      />

      <Band tone="ground">
        <LegalBody
          sections={[
            {
              heading: "No analytics and no tracking",
              body: [
                "This website runs no analytics, no advertising pixels, no session recording and no fingerprinting. There is no third-party script on any page, which is enforced by a content security policy that blocks requests to other hosts rather than by an intention not to add one.",
                "Fonts are served from this domain rather than from a font provider, so loading a page does not disclose your visit to anyone else.",
              ],
            },
            {
              heading: "No cookies",
              body: [
                "The site sets no cookies, which is why you have not been asked to consent to any.",
                "Your theme preference is stored in your browser's local storage on your own device. It is never sent anywhere, and clearing your browser data removes it.",
              ],
            },
            {
              heading: "The project form",
              body: [
                "If you submit the project form, what you type is sent to Corelith so we can reply to you. That is your name, your email address, an optional company name, the four selections, and your message.",
                "It is used to answer you and for nothing else. It is not added to a mailing list, not sold, not used for advertising, and not used to build a profile. There is no follow-up sequence: if you do not write back, nothing further is sent.",
                "The submission is transmitted over an encrypted connection. The server checks the size, rate and shape of the submission before accepting it, and logs failures without recording the contents of your message.",
              ],
            },
            {
              heading: "Server logs",
              body: [
                "Like any web server, the host serving this site keeps short-lived operational logs which can include IP addresses and requested paths. They exist to keep the site available and to identify abuse, and are not used to identify individual visitors.",
              ],
            },
            {
              heading: "Your data, your call",
              body: [
                `Write to ${site.email.general} and we will tell you what we hold from any submission you made and delete it on request. There is no account to close because there are no accounts.`,
              ],
            },
            {
              heading: "Changes",
              body: [
                "If this changes — for example if analytics is ever added — this page changes first and the date above changes with it. We will not quietly start collecting something this page says we do not.",
              ],
            },
          ]}
        />
      </Band>
    </>
  );
}
