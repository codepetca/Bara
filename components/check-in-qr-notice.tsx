import { Clock, ScanLine } from "lucide-react";
import { Card } from "@/components/ui/card";

export function CheckInQrNotice({ closed = false }: { closed?: boolean }) {
  const Icon = closed ? Clock : ScanLine;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md items-center px-4 py-8">
      <Card className="w-full px-6 py-8 text-center sm:px-8 sm:py-10">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-amber-100 text-amber-800">
          <Icon className="size-7" aria-hidden="true" />
        </div>
        <h1 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-slate-950">
          {closed ? "Check-in is closed" : "This QR code didn’t work"}
        </h1>
        <p className="mt-3 text-base leading-relaxed text-slate-600">
          {closed ? "Scan the classroom QR code again when check-in opens." : "Scan the current classroom QR code. If you still can’t check in, ask your teacher."}
        </p>
      </Card>
    </main>
  );
}
