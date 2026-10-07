// Every screen in one place (section 28) - the same tiles that rise from the course mark at the top of a
// phone, as a page of its own.

import { useNavSections } from '../components/Layout';
import { NavMenu } from '../components/NavMenu';
import { PageHead } from '../components/ui';

export function MorePage() {
  const navigation = useNavSections();
  return (
    <div className="page narrow more-page">
      <PageHead title="כל המסכים" docTitle="עוד" sub="כל הכלים של הקורס, במקום אחד." />
      <NavMenu sections={navigation} />
    </div>
  );
}
