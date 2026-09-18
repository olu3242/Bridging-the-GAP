import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/server/actions/auth";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="ghost" size="icon" aria-label="Sign out">
        <LogOut className="size-4" aria-hidden />
      </Button>
    </form>
  );
}
