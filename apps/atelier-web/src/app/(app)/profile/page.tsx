import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Unavailable } from "@/components/ui/states";
import { loadProfile } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { getFormatter } from "@/lib/request";
import type { ProfileSummary } from "@/lib/schemas";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("profile");
  return { title: t("title") };
}

/** The measurements every CV is cut from, read-only for now. */
export default async function ProfilePage() {
  const t = await getTranslations("profile");
  const loaded = await loadProfile();
  return (
    <main id="main" className="page">
      <header className="page-head">
        <h1>{t("title")}</h1>
        <p className="page-lead">{t("lead")}</p>
      </header>
      {loaded.status === "ok" ? (
        <Profile profile={loaded.data} />
      ) : (
        <Unavailable retryHref="/profile" />
      )}
    </main>
  );
}

async function Profile({ profile }: { profile: ProfileSummary }) {
  const t = await getTranslations("profile");
  const format = await getFormatter();
  const { form } = profile;
  const active = profile.cases.filter((c) => c.active).length;
  const rows: { key: string; label: string; value: string }[] = [
    { key: "location", label: t("location"), value: form.location },
    { key: "timezone", label: t("timezone"), value: form.timezone },
    { key: "workFormat", label: t("workFormat"), value: form.workFormat },
    { key: "contract", label: t("contract"), value: form.contract },
    {
      key: "salary",
      label: t("salary"),
      value: t("salaryValue", {
        amount: formatMoney(
          form.salaryFrom.amount,
          form.salaryFrom.currency,
          format.locale,
        ),
        period: t(`periods.${form.salaryFrom.period}`),
      }),
    },
    {
      key: "notice",
      label: t("notice"),
      value: t("noticeValue", { count: form.noticeWeeks }),
    },
    {
      key: "relocation",
      label: t("relocation"),
      value: form.relocation ? t("yes") : t("no"),
    },
    {
      key: "sponsorship",
      label: t("sponsorship"),
      value: form.needsSponsorship ? t("needs") : t("notNeeded"),
    },
    { key: "eeo", label: t("eeo"), value: t("eeoValue") },
  ];
  return (
    <div className="profile">
      <section className="profile-card" aria-labelledby="profile-who">
        <h2 id="profile-who" className="profile-name">
          {profile.name}
        </h2>
        <p className="profile-headline">{profile.headline}</p>
        <h3 className="sub-title">{t("preferences")}</h3>
        <dl className="facts">
          <div className="fact fact-wide">
            <dt>{t("factsMode")}</dt>
            <dd>
              <span className="mode-chip" data-mode={profile.factsMode}>
                {t(`factsModeNames.${profile.factsMode}`)}
              </span>
              <span className="fact-note">
                {t(`factsModes.${profile.factsMode}`)}
              </span>
            </dd>
          </div>
          <div className="fact fact-wide">
            <dt>{t("maxPages")}</dt>
            <dd>{t("maxPagesValue", { count: profile.maxPages })}</dd>
          </div>
        </dl>
      </section>

      <section className="profile-form" aria-labelledby="profile-form">
        <h2 id="profile-form" className="section-title">
          {t("form")}
        </h2>
        <dl className="form-answers">
          {rows.map((row) => (
            <div key={row.key} className="form-answer">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="profile-cases" aria-labelledby="profile-cases">
        <header className="section-head">
          <h2 id="profile-cases" className="section-title">
            {t("cases")}
            <span className="section-count">
              {t("casesCount", { active, total: profile.cases.length })}
            </span>
          </h2>
        </header>
        <table className="cases-table">
          <thead>
            <tr>
              <th scope="col">{t("columns.id")}</th>
              <th scope="col">{t("columns.company")}</th>
              <th scope="col">{t("columns.title")}</th>
              <th scope="col">{t("columns.technologies")}</th>
              <th scope="col">{t("columns.active")}</th>
            </tr>
          </thead>
          <tbody>
            {profile.cases.map((item) => (
              <tr key={item.id} data-active={item.active || undefined}>
                <td data-label={t("columns.id")}>
                  <span className="case-tag">{item.id}</span>
                </td>
                <td data-label={t("columns.company")}>{item.company}</td>
                <th scope="row" data-label={t("columns.title")}>
                  {item.title}
                </th>
                <td data-label={t("columns.technologies")}>
                  {item.technologies.length ? (
                    <ul className="tech-list">
                      {item.technologies.map((tech) => (
                        <li key={tech}>{tech}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="muted">{t("noTech")}</span>
                  )}
                </td>
                <td data-label={t("columns.active")}>
                  <span
                    className="active-chip"
                    data-active={item.active || undefined}
                  >
                    {item.active ? t("active") : t("inactive")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
