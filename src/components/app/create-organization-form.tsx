"use client";
import { useActionState, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Alert } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { idleState, type ActionState } from "@/server/actions/action-result";
import { slugify } from "@/domain/identity/organization";

type Action = (
  state: ActionState<{ id: string; slug: string }>,
  formData: FormData,
) => Promise<ActionState<{ id: string; slug: string }>>;

export function CreateOrganizationForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, idleState);
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const error = (field: string) => state.fieldErrors?.[field];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create an organization</CardTitle>
        <CardDescription>
          You become its first governing member. It stays pending until an operator activates it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4" noValidate>
          {state.status === "error" && !state.fieldErrors ? (
            <Alert tone="error">{state.message}</Alert>
          ) : null}
          {state.status === "success" ? <Alert tone="success">{state.message}</Alert> : null}

          <Field label="Name" htmlFor="name" error={error("name")}>
            <Input
              id="name"
              name="name"
              required
              aria-invalid={Boolean(error("name"))}
              onChange={(event) => {
                if (!slugTouched) setSlug(slugify(event.target.value));
              }}
              placeholder="University of Lagos"
            />
          </Field>
          <Field label="Handle" htmlFor="slug" hint="Lowercase letters, numbers and hyphens." error={error("slug")}>
            <Input
              id="slug"
              name="slug"
              required
              value={slug}
              aria-invalid={Boolean(error("slug"))}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value);
              }}
              placeholder="university-of-lagos"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="type" error={error("type")}>
              <Select id="type" name="type" defaultValue="institution">
                <option value="institution">Institution</option>
                <option value="employer">Employer</option>
                <option value="sponsor">Sponsor</option>
              </Select>
            </Field>
            <Field label="Country" htmlFor="countryCode" hint="Optional, e.g. NG." error={error("countryCode")}>
              <Input id="countryCode" name="countryCode" maxLength={2} className="uppercase" />
            </Field>
          </div>
          <Field label="Website" htmlFor="website" hint="Optional." error={error("website")}>
            <Input id="website" name="website" type="url" placeholder="https://example.edu" />
          </Field>

          <SubmitButton pendingLabel="Creating…">Create organization</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
