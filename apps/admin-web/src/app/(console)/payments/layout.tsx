import { SectionFrame } from "@/components/ui/section-frame";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <SectionFrame section="payments" permission="billing.read">
      {children}
    </SectionFrame>
  );
}
