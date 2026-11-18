/**
 * / — home list of inspections (plan §10). Separate mobile and desktop
 * screens; the server picks one from the device (lib/layout.ts).
 */
import { HomeDesktop } from "@/components/desktop/home/HomeDesktop";
import { HomeMobile } from "@/components/mobile/home/HomeMobile";
import { Responsive } from "@/components/shared/Responsive";
import { getDevice } from "@/lib/device";

export default async function Home() {
  return <Responsive device={await getDevice()} mobile={<HomeMobile />} desktop={<HomeDesktop />} />;
}
