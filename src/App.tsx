import "./App.css";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { NoDatabasePlaceholder } from "@/components/layout/NoDatabasePlaceholder";
import { Layout } from "@/components/layout/Layout";
import { MainPanel } from "@/components/layout/MainPanel";

export const App = () => {
  const activeDatabase = useFamilyTreeSettings((s) => s.selectedDatabase);

  return (
    <Layout>
      {activeDatabase ? <MainPanel /> : <NoDatabasePlaceholder />}
    </Layout>
  );
};
