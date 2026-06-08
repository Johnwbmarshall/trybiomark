import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  amIAdmin,
  deleteUser,
  listAllUsers,
  resetKyc,
  sendPasswordReset,
  setUserSuspended,
  updateUserEmail,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
  beforeLoad: async () => {
    try {
      const res = await amIAdmin();
      if (!res.isAdmin) throw redirect({ to: "/dashboard" });
    } catch {
      throw redirect({ to: "/dashboard" });
    }
  },
});

function AdminPage() {
  const listFn = useServerFn(listAllUsers);
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => listFn(),
  });

  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-users"] });

  const resetPwd = useServerFn(sendPasswordReset);
  const resetKycFn = useServerFn(resetKyc);
  const suspendFn = useServerFn(setUserSuspended);
  const deleteFn = useServerFn(deleteUser);
  const updateEmailFn = useServerFn(updateUserEmail);

  const mResetPwd = useMutation({
    mutationFn: (userId: string) => resetPwd({ data: { userId } }),
    onSuccess: () => toast.success("Password reset email sent"),
    onError: (e: Error) => toast.error(e.message),
  });
  const mResetKyc = useMutation({
    mutationFn: (userId: string) => resetKycFn({ data: { userId } }),
    onSuccess: () => {
      toast.success("KYC reset");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const mSuspend = useMutation({
    mutationFn: (v: { userId: string; suspend: boolean }) =>
      suspendFn({ data: v }),
    onSuccess: () => {
      toast.success("Updated");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const mDelete = useMutation({
    mutationFn: (userId: string) => deleteFn({ data: { userId } }),
    onSuccess: () => {
      toast.success("User deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const mEmail = useMutation({
    mutationFn: (v: { userId: string; email: string }) =>
      updateEmailFn({ data: v }),
    onSuccess: () => {
      toast.success("Email updated");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const users = (data?.users ?? []).filter((u) =>
    filter
      ? (u.email ?? "").toLowerCase().includes(filter.toLowerCase()) ||
        u.id.includes(filter)
      : true,
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-semibold mb-4">Admin · Users</h1>
      <div className="mb-4 flex gap-2 items-center">
        <Input
          placeholder="Filter by email or user id"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-sm"
        />
        <span className="text-sm text-muted-foreground">
          {users.length} user{users.length === 1 ? "" : "s"}
        </span>
      </div>

      {isLoading && <p>Loading…</p>}
      {error && <p className="text-destructive">{(error as Error).message}</p>}

      <div className="border rounded-md divide-y">
        {users.map((u) => {
          const isExpanded = expanded === u.id;
          const suspended = u.banned_until && new Date(u.banned_until) > new Date();
          return (
            <div key={u.id} className="p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{u.email ?? "(no email)"}</span>
                    {u.roles.includes("admin") && <Badge>admin</Badge>}
                    {suspended && <Badge variant="destructive">suspended</Badge>}
                    <Badge variant="secondary">kyc: {u.profile?.kyc_status ?? "—"}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {u.certificates.length} certs · {u.appealsCount} appeals
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 font-mono">
                    {u.id} · joined {new Date(u.created_at).toLocaleDateString()} · last sign-in{" "}
                    {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : "never"}
                  </div>
                </div>
                <div className="flex gap-1 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => setExpanded(isExpanded ? null : u.id)}>
                    {isExpanded ? "Hide" : "Details"}
                  </Button>
                  <Button size="sm" variant="outline" disabled={mResetPwd.isPending} onClick={() => mResetPwd.mutate(u.id)}>
                    Reset password
                  </Button>
                  <Button size="sm" variant="outline" disabled={mResetKyc.isPending} onClick={() => mResetKyc.mutate(u.id)}>
                    Reset KYC
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={mSuspend.isPending}
                    onClick={() => mSuspend.mutate({ userId: u.id, suspend: !suspended })}
                  >
                    {suspended ? "Unsuspend" : "Suspend"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={mDelete.isPending}
                    onClick={() => {
                      if (confirm(`Permanently delete ${u.email}? This removes their auth account and cascades data.`)) {
                        mDelete.mutate(u.id);
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>

              {isExpanded && (
                <div className="mt-3 pl-2 border-l-2 border-border space-y-3">
                  <EmailEditor
                    initial={u.email ?? ""}
                    onSave={(email) => mEmail.mutate({ userId: u.id, email })}
                    pending={mEmail.isPending}
                  />
                  <div>
                    <div className="text-xs font-semibold mb-1">Certificates</div>
                    {u.certificates.length === 0 ? (
                      <p className="text-xs text-muted-foreground">None</p>
                    ) : (
                      <ul className="text-xs space-y-0.5">
                        {u.certificates.map((c) => (
                          <li key={c.certificate_id}>
                            <span className="font-mono">{c.certificate_id}</span> · {c.project_name} ·{" "}
                            <span className="text-muted-foreground">{c.verification_status}</span> ·{" "}
                            {new Date(c.created_at).toLocaleDateString()}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmailEditor({
  initial,
  onSave,
  pending,
}: {
  initial: string;
  onSave: (email: string) => void;
  pending: boolean;
}) {
  const [v, setV] = useState(initial);
  return (
    <div className="flex gap-2 items-center">
      <span className="text-xs">Email:</span>
      <Input value={v} onChange={(e) => setV(e.target.value)} className="max-w-xs h-8 text-sm" />
      <Button size="sm" variant="outline" disabled={pending || v === initial} onClick={() => onSave(v)}>
        Save
      </Button>
    </div>
  );
}
