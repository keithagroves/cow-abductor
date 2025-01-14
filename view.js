class View {
    constructor() {
      this.x = 0;
      this.y = 0;
      this.scale = 1;
      this.zoomedIn = false;
    }
  

    updateZoom(lander, planets) {
      let minDistance = Infinity;
      let closestPlanet;
      for (let planet of planets) {
        let distToCenter = dist(lander.pos.x, lander.pos.y, planet.center.x, planet.center.y);
        if (distToCenter < minDistance) {
          minDistance = distToCenter;
          closestPlanet = planet;
        }
      }
      
      let approximateSurfaceDistance = max(0, minDistance - (closestPlanet.baseRadius + 100));
      minDistance = min(minDistance, approximateSurfaceDistance);
  
      const ZOOM_THRESHOLD = 500;
      const MAX_ZOOM = 2;
      const MIN_ZOOM = 0.7;
  
      if (minDistance < ZOOM_THRESHOLD) {
        let zoomFactor = map(minDistance, 0, ZOOM_THRESHOLD, MAX_ZOOM, MIN_ZOOM);
        this.scale += (zoomFactor - this.scale) * 0.1;
      } else {
        this.scale += (MIN_ZOOM - this.scale) * 0.1;
      }
    }
  
    updatePosition(lander) {
      let desiredX = -lander.pos.x * this.scale + width / 2;
      let desiredY = -lander.pos.y * this.scale + height / 2;
      
      let easing = 0.1;
      this.x += (desiredX - this.x) * easing;
      this.y += (desiredY - this.y) * easing;
    }
  }