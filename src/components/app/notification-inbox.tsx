"use client";
import { useActionState } from "react";
import { BellOff, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { idleState, type ActionState } from "@/server/actions/action-result";
import { formatRelative } from "@/lib/utils";
import type { NotificationRow } from "@/lib/db/types";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function NotificationInbox({
  notifications,
  action,
}: {
  notifications: NotificationRow[];
  action: Action;
}) {
  const [state, formAction] = useActionState(action, idleState);

  return (
    <Card id="notifications" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>Everything the platform has told you, newest first.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state.status === "error" ? <Alert tone="error">{state.message}</Alert> : null}
        {notifications.length === 0 ? (
          <EmptyState
            icon={BellOff}
            title="Nothing yet"
            description="You'll hear from us when your pathway, a review or a match needs you."
          />
        ) : (
          <ul className="divide-y divide-white/8">
            {notifications.map((notification) => {
              const unread = notification.status === "pending" || notification.status === "sent";
              return (
                <li key={notification.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <span
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${unread ? "bg-accent" : "bg-white/15"}`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{notification.title}</p>
                    {notification.body ? (
                      <p className="mt-0.5 text-sm text-ink-subtle">{notification.body}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-ink-subtle">
                      {formatRelative(notification.created_at)}
                      {unread ? "" : " · read"}
                    </p>
                  </div>
                  {unread ? (
                    <form action={formAction}>
                      <input type="hidden" name="notificationId" value={notification.id} />
                      <Button type="submit" variant="ghost" size="sm" aria-label={`Mark "${notification.title}" as read`}>
                        <Check className="size-4" aria-hidden />
                      </Button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
