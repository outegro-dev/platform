import { SectionFrame } from "@/components/ui/section-frame";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <SectionFrame section="wallet" permission="wallet.read">
      {children}
    </SectionFrame>
  );
}
