export default function Download() {
  return (
    <main>
      <h1>Download NeuroPause OS</h1>
      <table cellPadding={6} style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr><th align="left">Platform</th><th align="left">Status</th></tr>
        </thead>
        <tbody>
          <tr><td>macOS (Apple silicon)</td><td>DEVELOPMENT — installer builds exist; not yet notarized for public distribution</td></tr>
          <tr><td>Windows</td><td>PLANNED — installer configuration exists, unexercised</td></tr>
          <tr><td>Linux / Server / Mobile / Robot</td><td>NOT SUPPORTED YET</td></tr>
        </tbody>
      </table>
      <p style={{ color: '#666', fontSize: 14 }}>
        Downloads require a signed-in, pilot-eligible account. A download is not an installation
        authorization; installation is an explicit step with its own confirmation.
      </p>
    </main>
  );
}
