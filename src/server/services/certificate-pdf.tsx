import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { BRAND_NAME } from "@/lib/brand";
import { formatDate } from "@/lib/dates";

/**
 * The certificate as a PDF (spec 3.4). It carries exactly what the public verify page shows:
 * the name the learner chose, the course, the date and the verify link. No surname, no username,
 * no age, no school. Built-in fonts only, so nothing is fetched while rendering.
 */
export type CertificatePdfInput = { displayName: string; courseTitle: string; issuedAt: Date; verifyCode: string; verifyUrl: string };

const INK = "#14141F";
const MUTED = "#53536A";
const PRIMARY = "#4B32D4";

const styles = StyleSheet.create({
  page: { padding: 36, backgroundColor: "#FBFAF7", fontFamily: "Helvetica", color: INK },
  frame: { flexGrow: 1, borderWidth: 3, borderColor: INK, borderRadius: 14, padding: 40, justifyContent: "space-between" },
  brand: { fontSize: 14, fontFamily: "Helvetica-Bold", color: PRIMARY },
  heading: { fontSize: 34, fontFamily: "Helvetica-Bold", marginTop: 18 },
  lead: { fontSize: 14, color: MUTED, marginTop: 26 },
  name: { fontSize: 40, fontFamily: "Helvetica-Bold", marginTop: 8 },
  course: { fontSize: 24, fontFamily: "Helvetica-Bold", marginTop: 8 },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  label: { fontSize: 10, color: MUTED },
  value: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 3 },
  verify: { fontSize: 11, marginTop: 3 },
});

function CertificateDocument({ displayName, courseTitle, issuedAt, verifyCode, verifyUrl }: CertificatePdfInput) {
  return (
    <Document title={`Certificate: ${courseTitle}`} author={BRAND_NAME} subject="Certificate of completion" language="en-GB">
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.frame}>
          <View>
            <Text style={styles.brand}>{BRAND_NAME}</Text>
            <Text style={styles.heading}>Certificate of completion</Text>
            <Text style={styles.lead}>This certifies that</Text>
            <Text style={styles.name}>{displayName}</Text>
            <Text style={styles.lead}>completed the course and had their project accepted</Text>
            <Text style={styles.course}>{courseTitle}</Text>
          </View>
          <View style={styles.footer}>
            <View>
              <Text style={styles.label}>Date</Text>
              <Text style={styles.value}>{formatDate(issuedAt)}</Text>
            </View>
            <View>
              <Text style={styles.label}>Check this certificate is real</Text>
              <Text style={styles.verify}>{verifyUrl}</Text>
              <Text style={styles.label}>Code: {verifyCode}</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderCertificatePdf(input: CertificatePdfInput): Promise<Buffer> {
  return renderToBuffer(<CertificateDocument {...input} />);
}
