"""Default seeded legal documents (Terms of Service, Privacy Policy, Impressum).

These are admin-editable settings (see ``settings_service.DEFAULTS``) seeded on
first boot. They are a starting-point draft, not legal advice — every operator
is responsible for reviewing and adapting them (esp. the Impressum, which is a
placeholder) before relying on them. Kept in their own module because they are
long markdown blobs that would otherwise clutter ``settings_service.py``.

Documents are per-locale: the operator is based in Austria and the app ships
German + English, so German (``de``) is the authoritative/default legal locale
and English (``en``) is a secondary translation. ``LEGAL_LOCALES`` /
``LEGAL_DEFAULT_LOCALE`` are the single source of truth for which locales are
supported — reused by the settings service, API routes, and schemas.
"""

LEGAL_LOCALES: tuple[str, ...] = ("de", "en")
LEGAL_DEFAULT_LOCALE: str = "de"

DEFAULT_LEGAL_TERMS_BODY_DE = """\
> **Hinweis zur Vorlage:** Dies ist ein unverbindlicher Entwurf und keine \
Rechtsberatung. Der Betreiber muss dieses Dokument prüfen, anpassen und \
lokalisieren (einschließlich der unten stehenden Kontaktdaten), bevor er sich \
darauf verlässt.

# Nutzungsbedingungen

**Anbieter:** [Name / Firma des Betreibers — Platzhalter] ("der Anbieter")

## 1. Der Dienst

Family Workspace ("der Dienst") ermöglicht registrierten Nutzern das Erstellen, \
Verwalten und Teilen von Stammbäumen, einschließlich personenbezogener Daten \
wie Namen, Bildern, Daten, Orten, Dokumenten und — sofern ein Nutzer dies \
hochlädt — gesundheitsbezogener Informationen. Stammbäume können privat \
gehalten, mit bestimmten anderen Nutzern als Betrachter oder Bearbeiter \
geteilt oder über einen öffentlichen Link zugänglich gemacht werden. Es gibt \
standardmäßig keine öffentliche Selbstregistrierung; der Zugang wird vom \
Anbieter oder einem bestehenden Nutzer gewährt.

## 2. Pflichten der Nutzer

Sie sind für alle Daten verantwortlich, die Sie über den Dienst hochladen, \
eingeben oder teilen. Sie bestätigen, dass Sie dazu rechtlich befugt sind und, \
soweit gesetzlich erforderlich, die Zustimmung der betroffenen Person \
vorliegt — einschließlich der ausdrücklichen Einwilligung bei besonderen \
Kategorien personenbezogener Daten wie Gesundheitsdaten. Sie müssen geltendes \
Datenschutzrecht (einschließlich der DSGVO) einhalten, dürfen keine \
rechtswidrigen Inhalte hochladen und den Dienst nicht missbrauchen. Der \
Anbieter prüft oder verifiziert die Rechtmäßigkeit nutzergenerierter Inhalte \
nicht.

**Gesundheits- und andere besondere Datenkategorien.** Nutzer dürfen \
gesundheitsbezogene Informationen nur hochladen, wenn sie dazu berechtigt \
sind und, soweit gesetzlich erforderlich, die ausdrückliche Einwilligung der \
betroffenen Person vorliegt. Der Anbieter verarbeitet solche Daten \
ausschließlich im Auftrag des Nutzers zum Zweck der Speicherung, Anzeige und \
des Teilens von Stammbäumen innerhalb des Dienstes. Der Nutzer bleibt dafür \
verantwortlich, zu beurteilen, ob das Hochladen und Teilen solcher Daten \
rechtmäßig ist.

Sie behalten das Eigentum an den von Ihnen hochgeladenen Daten. Mit dem \
Hochladen räumen Sie dem Anbieter ein beschränktes, nicht-exklusives Recht \
ein, diese zu speichern, zu verarbeiten und anzuzeigen, ausschließlich um den \
Dienst in Ihrem Auftrag zu betreiben.

## 3. Öffentliche Links und Teilen

Wenn Sie einen Stammbaum über einen öffentlichen Link zugänglich machen, kann \
jede Person, die diesen Link erhält, dessen Inhalt einsehen — der Anbieter \
kann den Zugriff über den Link hinaus nicht einschränken. Sie sind dafür \
verantwortlich, zu entscheiden, was Sie öffentlich teilen, und tragen die \
Folgen eines unbefugten Zugriffs, der sich daraus ergibt, wie Sie einen \
öffentlichen Link erstellen, aufbewahren oder weitergeben.

## 4. Verfügbarkeit

Der Dienst wird "wie besehen" bereitgestellt, ohne Garantie für \
Betriebszeit oder Verfügbarkeit. Der Anbieter kann den Dienst jederzeit ganz \
oder teilweise ändern, aussetzen oder einstellen.

## 5. Haftung

Die Haftung des Anbieters ist auf Fälle von Vorsatz, grober Fahrlässigkeit, \
Personenschäden oder sonstige nach zwingendem Recht nicht ausschließbare \
Haftung beschränkt. Der Anbieter haftet nicht für Datenverlust, für \
unbefugten Zugriff infolge eigener Handlungen des Nutzers (einschließlich des \
Teilens von Links) oder für den Missbrauch des Dienstes durch einen Nutzer. \
**Nutzer sind selbst dafür verantwortlich, eigene Sicherungskopien** wichtiger \
Daten anzulegen.

## 6. Beendigung

Der Anbieter kann den Zugang eines Nutzers bei Verstoß gegen diese \
Nutzungsbedingungen oder aus betrieblichen Gründen aussetzen oder beenden.

## 7. Anwendbares Recht

Diese Nutzungsbedingungen unterliegen österreichischem Recht. Es gilt die \
Zuständigkeit der österreichischen Gerichte, vorbehaltlich zwingender \
verbraucherschutzrechtlicher Bestimmungen, die Ihnen das Recht einräumen \
können, Verfahren in Ihrem eigenen Gerichtsstand anzustrengen.

## 8. Änderungen dieser Nutzungsbedingungen

Der Anbieter kann diese Nutzungsbedingungen von Zeit zu Zeit aktualisieren. \
Wesentliche Änderungen erfordern eine erneute Zustimmung, bevor Sie den \
Dienst weiter nutzen können.

## 9. Kontakt

Fragen zu diesen Nutzungsbedingungen können gesendet werden an: \
**operator@example.com** *(Platzhalter — durch die tatsächliche \
Kontaktadresse des Betreibers ersetzen)*.
"""

DEFAULT_LEGAL_TERMS_BODY_EN = """\
> **Template notice:** This is a starting-point draft, not legal advice. The \
operator must review, adapt, and localize this document (including the \
contact details below) before relying on it.

# Terms of Service

**Provider:** [Operator name / company — placeholder] ("the Provider")

## 1. The Service

Family Workspace ("the Service") lets registered users create, manage, and share \
family workspaces, including personal data such as names, images, dates, \
locations, documents, and — where a user chooses to upload it — health-related \
information. Trees may be kept private, shared with specific other users as \
viewer or editor, or made accessible via a public link. There is no public \
self-registration by default; access is granted by the Provider or an \
existing user.

## 2. User responsibilities

You are responsible for all data you upload, enter, or share through the \
Service. You confirm that you have the legal right to do so and, where \
required by law, the consent of any person the data relates to — including \
explicit consent for special-category data such as health information. You \
must comply with applicable data protection law (including the GDPR), must \
not upload unlawful content, and must not misuse the Service. The Provider \
does not review or verify the legality of user-submitted content.

**Health and other special-category data.** Users may upload health-related \
information only if they have the right to do so and, where required by law, \
the explicit consent of the affected person. The Provider processes such data \
solely at the user's instruction for the purpose of storing, displaying, and \
sharing family workspaces within the Service. The user remains responsible for \
determining whether the upload and sharing of such data is lawful.

You retain ownership of the data you upload. By uploading it, you grant the \
Provider a limited, non-exclusive right to store, process, and display it \
solely to operate the Service on your behalf.

## 3. Public links and sharing

If you choose to make a tree accessible via a public link, anyone who obtains \
that link can view its contents — the Provider cannot restrict access beyond \
the link itself. You are responsible for deciding what to share publicly and \
for any consequences of unauthorized access resulting from how you create, \
store, or distribute a public link.

## 4. Availability

The Service is provided "as is", without any guarantee of uptime or \
availability. The Provider may change, suspend, or discontinue the Service, \
in whole or in part, at any time.

## 5. Liability

The Provider's liability is limited to cases of intent, gross negligence, \
personal injury, or other liability that cannot be excluded under mandatory \
law. The Provider is not liable for data loss, for unauthorized access caused \
by a user's own actions (including link-sharing), or for a user's misuse of \
the Service. **Users are responsible for keeping their own backups** of data \
they consider important.

## 6. Termination

The Provider may suspend or terminate a user's access in the event of a \
violation of these Terms or for operational reasons.

## 7. Governing law

These Terms are governed by Austrian law. The courts of Austria have \
jurisdiction, subject to mandatory consumer-protection provisions that may \
grant you the right to bring proceedings in your own jurisdiction.

## 8. Changes to these Terms

The Provider may update these Terms from time to time. Material changes will \
require renewed acceptance before you can continue using the Service.

## 9. Contact

Questions about these Terms can be sent to: **operator@example.com** \
*(placeholder — replace with the operator's real contact address)*.
"""

DEFAULT_LEGAL_PRIVACY_BODY_DE = """\
> **Hinweis zur Vorlage:** Dies ist ein kurzer, unverbindlicher Entwurf und \
keine Rechtsberatung. Der Betreiber muss dieses Dokument prüfen, anpassen und \
lokalisieren — einschließlich der unten stehenden Angaben zum \
Verantwortlichen und zu den Kontaktdaten — bevor er sich darauf verlässt, und \
sollte für seinen konkreten Einsatz und seine Rechtsordnung rechtlichen Rat \
einholen.

# Datenschutzerklärung

## Welche Daten gespeichert werden

Der Dienst speichert die von Ihnen und anderen Nutzern eingegebenen Daten, \
einschließlich Namen, Beziehungen, Daten, Orten, Fotos, Dokumenten und — \
sofern ein Nutzer dies hochlädt — gesundheitsbezogener Informationen über \
Familienmitglieder (eine besondere Kategorie personenbezogener Daten im \
Sinne der DSGVO).

## Rechtsgrundlage

Daten werden im Auftrag des Nutzers verarbeitet, der sie eingibt, um den von \
ihm angeforderten Stammbaum-Dienst bereitzustellen. Werden besondere \
Kategorien personenbezogener Daten (z. B. Gesundheitsdaten) hochgeladen, \
stützt sich die Verarbeitung auf die ausdrückliche Einwilligung, die dieser \
Nutzer von der betroffenen Person eingeholt hat, wie in den \
Nutzungsbedingungen beschrieben.

## Selbst-Hosting und Verantwortlicher

Diese Instanz des Dienstes wird selbst betrieben (self-hosted). Der \
**Betreiber dieser Instanz** — nicht die ursprünglichen Autoren des Dienstes \
— ist der datenschutzrechtlich Verantwortliche für die hier gespeicherten \
Daten und dafür zuständig, Aufbewahrung, Zugriff und Sicherheit angemessen \
für seinen Einsatzzweck zu konfigurieren.

## Aufbewahrung

Daten werden so lange aufbewahrt, wie der jeweilige Stammbaum oder das \
Konto besteht. Die Kontolöschung unterliegt einer (vom Betreiber \
konfigurierbaren) Karenzfrist, bevor die Daten endgültig gelöscht werden.

## Ihre Rechte

Vorbehaltlich des geltenden Rechts können Sie Auskunft über, Berichtigung \
von, Löschung von oder Export Ihrer personenbezogenen Daten verlangen sowie \
bestimmten Verarbeitungen widersprechen oder deren Einschränkung verlangen. \
Anfragen können über die unten stehende Kontaktadresse oder, soweit \
verfügbar, über die In-App-Konto- und Exportfunktionen gestellt werden.

## Sicherheit

Der Anbieter trifft angemessene technische und organisatorische Maßnahmen \
(wie Authentifizierung, Zugriffskontrolle und verschlüsselte Übertragung) \
zum Schutz gespeicherter Daten. Kein System kann zu 100 % als sicher \
garantiert werden.

## Kontakt

Fragen oder Anliegen zum Datenschutz können gesendet werden an: \
**operator@example.com** *(Platzhalter — durch die tatsächliche \
Kontaktadresse des Betreibers ersetzen)*.
"""

DEFAULT_LEGAL_PRIVACY_BODY_EN = """\
> **Template notice:** This is a short starting-point draft, not legal advice. \
The operator must review, adapt, and localize this document — including the \
data-controller and contact details below — before relying on it, and should \
seek legal advice for their specific deployment and jurisdiction.

# Privacy Policy

## What data is stored

The Service stores the data you and other users enter, including names, \
relationships, dates, locations, photos, documents, and — where a user \
chooses to upload it — health-related information about family members \
(a special category of personal data under the GDPR).

## Legal basis

Data is processed at the instruction of the user who enters it, in order to \
provide the family-tree service they requested. Where special-category data \
(such as health information) is uploaded, processing relies on the explicit \
consent obtained by that user from the person concerned, as described in the \
Terms of Service.

## Self-hosting and the data controller

This instance of the Service is self-hosted. The **operator of this instance** \
— not the Service's original authors — is the data controller for the data \
stored here, and is responsible for configuring retention, access, and \
security appropriately for their use case.

## Retention

Data is retained for as long as the relevant tree or account exists. Account \
deletion follows a grace period (configurable by the operator) before data is \
permanently purged.

## Your rights

Subject to applicable law, you may request access to, rectification of, \
deletion of, or export of your personal data, and may object to or restrict \
certain processing. Requests can be made through the contact below or, where \
available, the in-app account and export tools.

## Security

The Provider applies reasonable technical and organizational measures \
(such as authentication, access control, and encrypted transport) to protect \
stored data. No system can be guaranteed 100% secure.

## Contact

Privacy-related questions or requests can be sent to: \
**operator@example.com** *(placeholder — replace with the operator's real \
contact address)*.
"""

DEFAULT_LEGAL_IMPRINT_BODY_DE = """\
> **PLATZHALTER — der Betreiber muss dieses Impressum vor dem Live-Betrieb \
durch seine eigenen, gesetzlich erforderlichen Angaben ersetzen.** Viele \
Rechtsordnungen (in Österreich u. a. nach ECG/MedienG) verlangen ein \
korrektes Impressum für jeden öffentlich erreichbaren Dienst.

# Impressum

**Diensteanbieter:**
[Name / Firma des Betreibers — Platzhalter]
[Straße, Hausnummer — Platzhalter]
[Postleitzahl, Ort — Platzhalter]
[Land — Platzhalter]

**Kontakt:**
E-Mail: operator@example.com *(Platzhalter)*
Telefon: [Platzhalter]

**Verantwortlich für den Inhalt:**
[Name / Firma des Betreibers — Platzhalter]

**Hinweis:** Dieser Platzhalter muss vor dem produktiven Betrieb für echte \
Nutzer durch die tatsächlichen, rechtlich korrekten Angaben des Betreibers \
ersetzt werden (Name/Firma, Anschrift, Kontaktdaten sowie ggf. erforderliche \
Firmenbuch-/UID-Nummern).
"""

DEFAULT_LEGAL_IMPRINT_BODY_EN = """\
> **PLACEHOLDER — the operator must replace this Impressum with their own \
legally required details before going live.** Many jurisdictions (including \
Austria, under the ECG/MedienG) legally require an accurate Impressum/legal \
notice for any publicly reachable service.

# Impressum / Legal Notice

**Service provider:**
[Operator name / company — placeholder]
[Street address — placeholder]
[Postal code, City — placeholder]
[Country — placeholder]

**Contact:**
Email: operator@example.com *(placeholder)*
Phone: [placeholder]

**Responsible for content:**
[Operator name / company — placeholder]

**Note:** This placeholder must be replaced with the operator's real, legally \
accurate details (name/company, address, contact information, and any \
required register/VAT numbers) before the Service is operated for real users.
"""

# Maps document_type -> locale -> default body. Reused by settings_service to
# build the per-locale DEFAULTS keys (``legal_<doc>_body_<locale>``).
DEFAULT_LEGAL_BODIES: dict[str, dict[str, str]] = {
    "terms": {
        "de": DEFAULT_LEGAL_TERMS_BODY_DE,
        "en": DEFAULT_LEGAL_TERMS_BODY_EN,
    },
    "privacy": {
        "de": DEFAULT_LEGAL_PRIVACY_BODY_DE,
        "en": DEFAULT_LEGAL_PRIVACY_BODY_EN,
    },
    "imprint": {
        "de": DEFAULT_LEGAL_IMPRINT_BODY_DE,
        "en": DEFAULT_LEGAL_IMPRINT_BODY_EN,
    },
}
