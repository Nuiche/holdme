import Card from "@/components/Card";
import CreateHoldForm from "@/components/CreateHoldForm";

export default function CreatePage() {
  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      <Card padding="lg">
        <CreateHoldForm />
      </Card>
    </div>
  );
}
